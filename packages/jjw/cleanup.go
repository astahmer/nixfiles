package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func cleanup(opts options) error {
	if !terminalAvailable() {
		return errors.New("jjw cleanup needs an interactive terminal")
	}
	rows, warnings, err := scanWorkspaces(opts)
	if err != nil {
		return err
	}
	printWarnings(warnings)
	rows = filterWorkspaces(rows, opts)
	if len(rows) == 0 {
		fmt.Fprintln(os.Stdout, "No workspaces match these filters.")
		return nil
	}

	selected, err := selectWorkspaces(rows, opts)
	if err != nil {
		return err
	}
	if len(selected) == 0 {
		fmt.Fprintln(os.Stdout, "No workspaces selected.")
		return nil
	}
	for _, row := range selected {
		if row.Action != "review" {
			return fmt.Errorf("%s (%s) is protected; select only rows marked review", row.Name, row.Action)
		}
	}

	fmt.Fprintf(os.Stdout, "Selected %d workspaces for cleanup:\n", len(selected))
	for _, row := range selected {
		fmt.Fprintf(os.Stdout, "  %s  %s  %s\n", row.Source, displayValue(row.Name), displayValue(row.Path))
	}
	fmt.Fprint(os.Stdout, "Type delete to continue: ")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("read confirmation: %w", err)
	}
	if strings.TrimSpace(answer) != "delete" {
		fmt.Fprintln(os.Stdout, "Cleanup cancelled.")
		return nil
	}

	var cleanupErrors []string
	for _, row := range selected {
		if err := deleteWorkspace(opts, row); err != nil {
			cleanupErrors = append(cleanupErrors, fmt.Sprintf("%s (%s): %v", row.Path, row.Source, err))
			continue
		}
		fmt.Fprintf(os.Stdout, "Removed %s (%s)\n", displayValue(row.Name), row.Source)
	}
	if len(cleanupErrors) > 0 {
		return errors.New(strings.Join(cleanupErrors, "\n"))
	}
	return nil
}

func selectWorkspaces(rows []workspace, opts options) ([]workspace, error) {
	var input bytes.Buffer
	rowByID := make(map[string]workspace, len(rows))
	for index, row := range rows {
		id := fmt.Sprintf("%06d", index+1)
		rowByID[id] = row
		age := "?"
		if row.AgeDays != nil {
			age = fmt.Sprint(*row.AgeDays)
		}
		fmt.Fprintf(&input, "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			id,
			displayValue(row.Source),
			displayValue(row.Name),
			displayValue(row.Repository),
			displayValue(row.Path),
			dateOrUnknown(row.LastChange),
			dateOrUnknown(row.Created),
			age,
			displayValue(row.State),
			displayValue(row.Action),
		)
	}
	arguments := []string{
		"--multi",
		"--border",
		"--layout=reverse",
		"--no-hscroll",
		"--with-nth=2..",
		"--delimiter=\t",
		"--prompt=jjw cleanup> ",
		fmt.Sprintf("--header=Age basis: %s · Tab selects · Enter confirms · review rows only", opts.ageBasis),
		"--header-first",
	}
	if opts.filter != "" {
		arguments = append(arguments, "--query", opts.filter)
	}
	command := exec.Command("fzf", arguments...)
	command.Stdin = &input
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) && (exitError.ExitCode() == 1 || exitError.ExitCode() == 130) {
			return nil, nil
		}
		return nil, fmt.Errorf("run fzf: %w", err)
	}
	selected := make([]workspace, 0)
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		if line == "" {
			continue
		}
		id, _, found := strings.Cut(line, "\t")
		if !found {
			return nil, errors.New("fzf returned an invalid row")
		}
		row, exists := rowByID[id]
		if !exists {
			return nil, fmt.Errorf("fzf returned unknown row %q", id)
		}
		selected = append(selected, row)
	}
	return selected, nil
}

func deleteWorkspace(opts options, row workspace) error {
	root, err := canonicalDirectory(opts.root)
	if err != nil {
		return err
	}
	workspacePath, err := filepath.EvalSymlinks(row.Path)
	if err != nil {
		return fmt.Errorf("workspace path is missing: %w", err)
	}
	workspacePath = filepath.Clean(workspacePath)
	if !pathWithin(root, workspacePath, false) || samePath(workspacePath, row.Repository) {
		return errors.New("refusing to remove a workspace outside the scan root or repository root")
	}
	currentDirectory, _ := os.Getwd()
	if resolvedDirectory, resolveErr := filepath.EvalSymlinks(currentDirectory); resolveErr == nil {
		currentDirectory = resolvedDirectory
	}
	if directoryContains(workspacePath, currentDirectory) {
		return errors.New("refusing to remove the current directory")
	}
	state, err := workspaceState(row)
	if err != nil {
		return err
	}
	if state != "clean" {
		return fmt.Errorf("workspace changed since scan; current state is %s", state)
	}

	if row.jjName != "" {
		if row.gitRepo == "" {
			if _, statErr := os.Lstat(filepath.Join(workspacePath, ".git")); statErr == nil {
				return errors.New("workspace has Git metadata that jjw could not verify; refusing to remove")
			}
		}
	}
	if err := verifyWorkspaceAge(opts, row); err != nil {
		return err
	}

	if row.jjName != "" {
		if _, err := runCommand("jj", "--ignore-working-copy", "-R", row.Repository, "workspace", "forget", row.jjName); err != nil {
			return fmt.Errorf("forget JJ workspace: %w", err)
		}
	}
	if row.gitRepo != "" {
		if _, err := runCommand("git", "-C", row.gitRepo, "worktree", "remove", "--", workspacePath); err != nil {
			if row.jjName != "" {
				return fmt.Errorf("workspace forgotten from JJ but Git worktree removal failed: %w", err)
			}
			return fmt.Errorf("remove Git worktree: %w", err)
		}
		return nil
	}
	if row.jjName == "" {
		return errors.New("workspace is not registered as JJ or Git worktree")
	}
	if err := os.RemoveAll(workspacePath); err != nil {
		return fmt.Errorf("remove workspace directory: %w", err)
	}
	return nil
}

func verifyWorkspaceAge(opts options, row workspace) error {
	lastChange := ""
	created := ""
	if row.jjName != "" {
		output, err := runCommand("jj", "--ignore-working-copy", "-R", row.Repository, "workspace", "list", "--template", jjWorkspaceTemplate)
		if err != nil {
			return fmt.Errorf("verify JJ workspace: %w", err)
		}
		records, err := parseJJWorkspaceRecords(output)
		if err != nil {
			return fmt.Errorf("verify JJ workspace list: %w", err)
		}
		found := false
		for _, record := range records {
			if record.Name != row.jjName {
				continue
			}
			registeredPath, pathErr := normalizeWorkspacePath(record.Path)
			if pathErr != nil || !samePath(registeredPath, row.Path) {
				return fmt.Errorf("JJ workspace path changed since scan: registered %q, selected %q", registeredPath, row.Path)
			}
			lastChange = laterDate(lastChange, record.LastChange)
			found = true
			break
		}
		if !found {
			return fmt.Errorf("JJ workspace %q is no longer registered", row.jjName)
		}
		if createdAt, createErr := filesystemCreatedAt(jjCreationMarker(row.Path)); createErr == nil {
			created = laterDate(created, createdAt.Format("2006-01-02"))
		}
	}
	if row.gitRepo != "" {
		gitDate, err := gitLastChange(row.Path)
		if err != nil {
			return fmt.Errorf("verify Git workspace age: %w", err)
		}
		lastChange = laterDate(lastChange, gitDate)
		if createdAt, createErr := filesystemCreatedAt(filepath.Join(row.Path, ".git")); createErr == nil {
			created = laterDate(created, createdAt.Format("2006-01-02"))
		}
	}
	age := ageInDays(lastChange, created, opts.ageBasis, time.Now())
	if age == nil {
		return errors.New("workspace age is unknown now; refusing to remove")
	}
	if *age < opts.olderThanDays {
		return fmt.Errorf("workspace is now recent (%d days old; threshold is %d); refusing to remove", *age, opts.olderThanDays)
	}
	return nil
}

func workspaceState(row workspace) (string, error) {
	state := "clean"
	if row.jjName != "" {
		jjState, err := jjWorkspaceState(row.Path)
		if err != nil {
			return "unknown", err
		}
		if jjState != "clean" {
			state = jjState
		}
	}
	if row.gitRepo != "" {
		gitState, err := gitWorkspaceState(row.Path)
		if err != nil {
			return "unknown", err
		}
		if gitState != "clean" {
			state = gitState
		}
	}
	return state, nil
}

func terminalAvailable() bool {
	stdinInfo, stdinErr := os.Stdin.Stat()
	stdoutInfo, stdoutErr := os.Stdout.Stat()
	return stdinErr == nil && stdoutErr == nil && stdinInfo.Mode()&os.ModeCharDevice != 0 && stdoutInfo.Mode()&os.ModeCharDevice != 0
}
