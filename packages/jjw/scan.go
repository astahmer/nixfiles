package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const jjWorkspaceTemplate = `json(self.name()) ++ "\t" ++ json(self.root()) ++ "\t" ++ json(self.target().commit_id()) ++ "\t" ++ json(self.target().committer().timestamp().format("%Y-%m-%d")) ++ "\n"`

type workspace struct {
	Source     string `json:"source"`
	Name       string `json:"name"`
	Repository string `json:"repository"`
	Path       string `json:"path"`
	Commit     string `json:"commit"`
	LastChange string `json:"last_change"`
	Created    string `json:"created"`
	AgeDays    *int   `json:"age_days"`
	State      string `json:"state"`
	Action     string `json:"action"`
	jjName     string `json:"-"`
	gitRepo    string `json:"-"`
}

type jjWorkspaceRecord struct {
	Name       string
	Path       string
	Commit     string
	LastChange string
}

type gitWorktreeRecord struct {
	Path   string
	Commit string
}

type repositoryCandidate struct {
	path string
}

func scanWorkspaces(opts options) ([]workspace, []string, error) {
	root, err := canonicalDirectory(opts.root)
	if err != nil {
		return nil, nil, err
	}
	currentDirectory, _ := os.Getwd()
	currentDirectory, _ = filepath.Abs(currentDirectory)
	if resolvedDirectory, resolveErr := filepath.EvalSymlinks(currentDirectory); resolveErr == nil {
		currentDirectory = resolvedDirectory
	}

	var jjRows, gitRows []workspace
	var jjWarnings, gitWarnings []string
	var scans sync.WaitGroup
	scans.Add(2)
	go func() {
		defer scans.Done()
		jjRows, jjWarnings = scanJJWorkspaces(root, opts)
	}()
	go func() {
		defer scans.Done()
		gitRows, gitWarnings = scanGitWorktrees(root)
	}()
	scans.Wait()
	rows := mergeWorkspaces(append(jjRows, gitRows...))
	var stateWarnings []string
	if opts.checkState {
		stateWarnings = populateWorkspaceStates(rows)
	} else {
		for index := range rows {
			rows[index].State = "unchecked"
		}
	}
	now := time.Now()
	for index := range rows {
		rows[index].AgeDays = ageInDays(rows[index].LastChange, rows[index].Created, opts.ageBasis, now)
		rows[index].Action = workspaceAction(rows[index], currentDirectory, opts.olderThanDays)
	}
	warnings := append(jjWarnings, gitWarnings...)
	warnings = append(warnings, stateWarnings...)
	return rows, warnings, nil
}

func parallelFor(count int, task func(int)) {
	if count == 0 {
		return
	}
	workerCount := runtime.NumCPU() * 8
	if workerCount < 4 {
		workerCount = 4
	}
	if workerCount > 64 {
		workerCount = 64
	}
	if workerCount > count {
		workerCount = count
	}
	jobs := make(chan int)
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
		go func() {
			defer workers.Done()
			for index := range jobs {
				task(index)
			}
		}()
	}
	for index := 0; index < count; index++ {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
}

func discoverRepositories(root string, markerName string) ([]repositoryCandidate, []string) {
	paths := []string{root}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, []string{fmt.Sprintf("read scan root %s: %v", root, err)}
	}
	for _, entry := range entries {
		candidatePath := filepath.Join(root, entry.Name())
		if entry.Type().IsDir() {
			paths = append(paths, candidatePath)
			continue
		}
		if entry.Type()&os.ModeSymlink == 0 && entry.Type() != 0 {
			continue
		}
		info, infoErr := os.Stat(candidatePath)
		if infoErr != nil || !info.IsDir() {
			continue
		}
		canonicalPath, canonicalErr := filepath.EvalSymlinks(candidatePath)
		if canonicalErr == nil && pathWithin(root, canonicalPath, true) {
			paths = append(paths, canonicalPath)
		}
	}

	candidates := make([]repositoryCandidate, 0)
	for _, candidatePath := range paths {
		marker := filepath.Join(candidatePath, markerName)
		if _, statErr := os.Lstat(marker); statErr == nil {
			candidates = append(candidates, repositoryCandidate{path: candidatePath})
		}
	}
	return candidates, nil
}

func scanJJWorkspaces(root string, opts options) ([]workspace, []string) {
	candidates, warnings := discoverRepositories(root, ".jj")
	type repository struct {
		path      string
		storePath string
	}
	repositories := make([]repository, 0)
	seenStores := make(map[string]struct{})
	for _, candidate := range candidates {
		storePath, err := resolveJJStore(candidate.path)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("resolve JJ store for %s: %v", candidate.path, err))
			continue
		}
		if _, exists := seenStores[storePath]; exists {
			continue
		}
		seenStores[storePath] = struct{}{}
		repositories = append(repositories, repository{path: candidate.path, storePath: storePath})
	}

	type result struct {
		rows     []workspace
		warnings []string
	}
	results := make([]result, len(repositories))
	parallelFor(len(repositories), func(index int) {
		candidate := repositories[index]
		output, err := runCommand("jj", "--ignore-working-copy", "-R", candidate.path, "workspace", "list", "--template", jjWorkspaceTemplate)
		if err != nil {
			results[index].warnings = []string{fmt.Sprintf("list JJ workspaces for %s: %v", candidate.path, err)}
			return
		}
		records, parseErr := parseJJWorkspaceRecords(output)
		if parseErr != nil {
			results[index].warnings = []string{fmt.Sprintf("parse JJ workspace list for %s: %v", candidate.path, parseErr)}
			return
		}
		repositoryPath := filepath.Dir(filepath.Dir(candidate.storePath))
		for _, record := range records {
			if record.Name == "default" && !opts.withDefault {
				continue
			}
			workspacePath, pathErr := normalizeWorkspacePath(record.Path)
			if pathErr != nil || !pathWithin(root, workspacePath, true) {
				continue
			}
			workspaceInfo, workspaceErr := os.Stat(workspacePath)
			if workspaceErr != nil || !workspaceInfo.IsDir() {
				continue
			}
			created, createErr := filesystemCreatedAt(jjCreationMarker(workspacePath))
			createdDate := ""
			if createErr == nil {
				createdDate = created.Format("2006-01-02")
			}
			results[index].rows = append(results[index].rows, workspace{
				Source:     "jj",
				Name:       record.Name,
				Repository: repositoryPath,
				Path:       workspacePath,
				Commit:     shortCommit(record.Commit),
				LastChange: record.LastChange,
				Created:    createdDate,
				jjName:     record.Name,
			})
		}
	})
	rows := make([]workspace, 0)
	for _, result := range results {
		rows = append(rows, result.rows...)
		warnings = append(warnings, result.warnings...)
	}
	return rows, warnings
}

func resolveJJStore(workspacePath string) (string, error) {
	marker := filepath.Join(workspacePath, ".jj", "repo")
	info, err := os.Stat(marker)
	if err != nil {
		legacyMarker := filepath.Join(workspacePath, ".jj")
		legacyInfo, legacyErr := os.Stat(legacyMarker)
		if legacyErr != nil || legacyInfo.IsDir() {
			return "", err
		}
		contents, readErr := os.ReadFile(legacyMarker)
		if readErr != nil {
			return "", readErr
		}
		return resolveJJStorePointer(string(contents), workspacePath)
	}
	if info.IsDir() {
		resolved, resolveErr := filepath.EvalSymlinks(marker)
		if resolveErr != nil {
			return "", resolveErr
		}
		return filepath.Abs(resolved)
	}
	contents, err := os.ReadFile(marker)
	if err != nil {
		return "", err
	}
	return resolveJJStorePointer(string(contents), filepath.Dir(marker))
}

func resolveJJStorePointer(contents string, basePath string) (string, error) {
	target := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(contents), "gitdir:"))
	if target == "" {
		return "", errors.New("empty .jj/repo pointer")
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(basePath, target)
	}
	if filepath.Base(target) == ".jj" {
		target = filepath.Join(target, "repo")
	}
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return "", err
	}
	return filepath.Abs(resolved)
}

func jjCreationMarker(workspacePath string) string {
	marker := filepath.Join(workspacePath, ".jj", "repo")
	if _, err := os.Lstat(marker); err == nil {
		return marker
	}
	return filepath.Join(workspacePath, ".jj")
}

func parseJJWorkspaceRecords(output []byte) ([]jjWorkspaceRecord, error) {
	records := make([]jjWorkspaceRecord, 0)
	for lineNumber, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 4 {
			return nil, fmt.Errorf("line %d has %d fields", lineNumber+1, len(fields))
		}
		values := make([]string, len(fields))
		for index, field := range fields {
			if err := json.Unmarshal([]byte(field), &values[index]); err != nil {
				return nil, fmt.Errorf("line %d field %d: %w", lineNumber+1, index+1, err)
			}
		}
		if values[0] == "" || values[1] == "" {
			continue
		}
		records = append(records, jjWorkspaceRecord{
			Name:       values[0],
			Path:       values[1],
			Commit:     values[2],
			LastChange: values[3],
		})
	}
	return records, nil
}

func scanGitWorktrees(root string) ([]workspace, []string) {
	candidates, warnings := discoverRepositories(root, ".git")
	type gitRepository struct {
		candidate repositoryCandidate
		commonDir string
	}
	type discoveryResult struct {
		commonDir string
		warning   string
	}
	discoveries := make([]discoveryResult, len(candidates))
	parallelFor(len(candidates), func(index int) {
		candidate := candidates[index]
		commonDir, err := resolveGitCommonDir(candidate.path)
		if err != nil {
			discoveries[index].warning = fmt.Sprintf("resolve Git repository for %s: %v", candidate.path, err)
			return
		}
		discoveries[index].commonDir = commonDir
	})

	seenRepos := make(map[string]gitRepository)
	for index, discovery := range discoveries {
		if discovery.warning != "" {
			warnings = append(warnings, discovery.warning)
			continue
		}
		if _, exists := seenRepos[discovery.commonDir]; !exists {
			seenRepos[discovery.commonDir] = gitRepository{candidate: candidates[index], commonDir: discovery.commonDir}
		}
	}
	repositories := make([]gitRepository, 0, len(seenRepos))
	for _, repository := range seenRepos {
		repositories = append(repositories, repository)
	}
	sort.Slice(repositories, func(left int, right int) bool { return repositories[left].commonDir < repositories[right].commonDir })
	type scanResult struct {
		rows     []workspace
		warnings []string
	}
	results := make([]scanResult, len(repositories))
	parallelFor(len(repositories), func(index int) {
		entry := repositories[index]
		candidate := entry.candidate
		commonDir := entry.commonDir
		var worktrees []gitWorktreeRecord
		lastChanges := make(map[string]string)
		adminEntries, adminErr := os.ReadDir(filepath.Join(commonDir, "worktrees"))
		if adminErr != nil && !errors.Is(adminErr, os.ErrNotExist) {
			results[index].warnings = []string{fmt.Sprintf("read Git worktree metadata for %s: %v", candidate.path, adminErr)}
			return
		}
		if adminErr == nil && len(adminEntries) > 0 {
			output, err := runCommand("git", "-C", candidate.path, "worktree", "list", "--porcelain", "-z")
			if err != nil {
				results[index].warnings = []string{fmt.Sprintf("list Git worktrees for %s: %v", candidate.path, err)}
				return
			}
			worktrees, err = parseGitWorktreeRecords(output)
			if err != nil {
				results[index].warnings = []string{fmt.Sprintf("parse Git worktrees for %s: %v", candidate.path, err)}
				return
			}
			lastChanges, err = gitCommitDates(candidate.path, worktrees)
			if err != nil {
				results[index].warnings = append(results[index].warnings, fmt.Sprintf("read Git commit dates for %s: %v", candidate.path, err))
			}
		} else {
			worktree, lastChange, err := gitHeadRecord(candidate.path)
			if err != nil {
				results[index].warnings = []string{fmt.Sprintf("read Git HEAD for %s: %v", candidate.path, err)}
				worktree.Path = candidate.path
			}
			worktrees = []gitWorktreeRecord{worktree}
			if worktree.Commit != "" {
				lastChanges[worktree.Commit] = lastChange
			}
		}
		repositoryPath := filepath.Dir(commonDir)
		for _, worktree := range worktrees {
			workspacePath, pathErr := normalizeWorkspacePath(worktree.Path)
			if pathErr != nil || !pathWithin(root, workspacePath, true) {
				continue
			}
			workspaceInfo, workspaceErr := os.Stat(workspacePath)
			if workspaceErr != nil || !workspaceInfo.IsDir() {
				continue
			}
			createdDate := ""
			if created, createErr := filesystemCreatedAt(filepath.Join(workspacePath, ".git")); createErr == nil {
				createdDate = created.Format("2006-01-02")
			}
			row := workspace{
				Source:     "git",
				Name:       filepath.Base(workspacePath),
				Repository: repositoryPath,
				Path:       workspacePath,
				Commit:     shortCommit(worktree.Commit),
				LastChange: lastChanges[worktree.Commit],
				Created:    createdDate,
				gitRepo:    repositoryPath,
			}
			results[index].rows = append(results[index].rows, row)
		}
	})
	rows := make([]workspace, 0)
	for _, result := range results {
		rows = append(rows, result.rows...)
		warnings = append(warnings, result.warnings...)
	}
	return rows, warnings
}

func resolveGitCommonDir(workspacePath string) (string, error) {
	marker := filepath.Join(workspacePath, ".git")
	info, err := os.Stat(marker)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		resolved, err := filepath.EvalSymlinks(marker)
		if err != nil {
			return "", err
		}
		return filepath.Abs(resolved)
	}
	contents, err := os.ReadFile(marker)
	if err != nil {
		return "", err
	}
	gitDir := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(contents)), "gitdir:"))
	if gitDir == "" {
		return "", fmt.Errorf("invalid .git pointer in %s", workspacePath)
	}
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(workspacePath, gitDir)
	}
	gitDir, err = filepath.Abs(gitDir)
	if err != nil {
		return "", err
	}
	gitDir, err = filepath.EvalSymlinks(gitDir)
	if err != nil {
		return "", err
	}
	adminParent := filepath.Dir(gitDir)
	commonDir := gitDir
	if filepath.Base(adminParent) == "worktrees" {
		commonDir = filepath.Dir(adminParent)
	}
	return filepath.Abs(commonDir)
}

func parseGitWorktreeRecords(output []byte) ([]gitWorktreeRecord, error) {
	fields := strings.Split(string(output), "\x00")
	worktrees := make([]gitWorktreeRecord, 0)
	current := gitWorktreeRecord{}
	flush := func() {
		if current.Path != "" {
			worktrees = append(worktrees, current)
		}
		current = gitWorktreeRecord{}
	}
	for _, field := range fields {
		if field == "" {
			flush()
			continue
		}
		if strings.HasPrefix(field, "worktree ") {
			flush()
			current.Path = strings.TrimPrefix(field, "worktree ")
			continue
		}
		if strings.HasPrefix(field, "HEAD ") {
			current.Commit = strings.TrimPrefix(field, "HEAD ")
		}
	}
	flush()
	if len(worktrees) == 0 && len(output) != 0 {
		return nil, errors.New("no worktree entries found")
	}
	return worktrees, nil
}

func gitLastChange(workspacePath string) (string, error) {
	output, err := runCommand("git", "-C", workspacePath, "log", "-1", "--format=%cs", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func gitCommitDates(repositoryPath string, worktrees []gitWorktreeRecord) (map[string]string, error) {
	commits := make([]string, 0, len(worktrees))
	seenCommits := make(map[string]struct{}, len(worktrees))
	for _, worktree := range worktrees {
		if worktree.Commit == "" {
			continue
		}
		if _, exists := seenCommits[worktree.Commit]; exists {
			continue
		}
		seenCommits[worktree.Commit] = struct{}{}
		commits = append(commits, worktree.Commit)
	}
	if len(commits) == 0 {
		return map[string]string{}, nil
	}
	args := []string{"-C", repositoryPath, "log", "--no-walk", "--format=%H%x09%cs"}
	args = append(args, commits...)
	output, err := runCommand("git", args...)
	if err != nil {
		return nil, err
	}
	commitDates := make(map[string]string, len(commits))
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.SplitN(line, "\t", 2)
		if len(fields) == 2 {
			commitDates[fields[0]] = fields[1]
		}
	}
	return commitDates, nil
}

func gitHeadRecord(repositoryPath string) (gitWorktreeRecord, string, error) {
	output, err := runCommand("git", "-C", repositoryPath, "log", "-1", "--format=%H%x09%cs", "HEAD")
	if err != nil {
		return gitWorktreeRecord{}, "", err
	}
	fields := strings.SplitN(strings.TrimSpace(string(output)), "\t", 2)
	if len(fields) != 2 || fields[0] == "" {
		return gitWorktreeRecord{}, "", errors.New("Git returned an invalid HEAD record")
	}
	return gitWorktreeRecord{Path: repositoryPath, Commit: fields[0]}, fields[1], nil
}

func jjWorkspaceState(workspacePath string) (string, error) {
	output, err := runCommand("jj", "-R", workspacePath, "status")
	if err != nil {
		return "unknown", err
	}
	status := string(output)
	if strings.Contains(status, "The working copy has no changes.") {
		return "clean", nil
	}
	if strings.Contains(status, "Working copy changes:") {
		return "dirty", nil
	}
	return "unknown", errors.New("unrecognized jj status output")
}

func gitWorkspaceState(workspacePath string) (string, error) {
	output, err := runCommand("git", "-C", workspacePath, "status", "--porcelain=v1", "--untracked-files=normal")
	if err != nil {
		return "unknown", err
	}
	if len(bytes.TrimSpace(output)) == 0 {
		return "clean", nil
	}
	return "dirty", nil
}

func populateWorkspaceStates(rows []workspace) []string {
	if len(rows) == 0 {
		return nil
	}
	stateErrors := make([]error, len(rows))
	parallelFor(len(rows), func(index int) {
		state, err := workspaceState(rows[index])
		rows[index].State = state
		stateErrors[index] = err
	})

	warnings := make([]string, 0)
	for index, stateErr := range stateErrors {
		if stateErr != nil {
			warnings = append(warnings, fmt.Sprintf("check %s workspace %s: %v", rows[index].Source, rows[index].Path, stateErr))
		}
	}
	return warnings
}

func workspaceAction(row workspace, currentDirectory string, olderThanDays int) string {
	if samePath(row.Path, row.Repository) {
		return "protected-root"
	}
	if directoryContains(row.Path, currentDirectory) {
		return "protected-current"
	}
	if row.State != "clean" && row.State != "unchecked" {
		return "protected-" + row.State
	}
	if row.AgeDays == nil {
		return "unknown-age"
	}
	if *row.AgeDays >= olderThanDays {
		return "review"
	}
	return "recent"
}

func ageInDays(lastChange string, created string, basis string, now time.Time) *int {
	date := lastChange
	if basis == "created" {
		date = created
	}
	parsedDate, err := time.ParseInLocation("2006-01-02", date, time.Local)
	if err != nil {
		return nil
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	observed := time.Date(parsedDate.Year(), parsedDate.Month(), parsedDate.Day(), 0, 0, 0, 0, time.UTC)
	days := int(today.Sub(observed).Hours() / 24)
	if days < 0 {
		days = 0
	}
	return &days
}

func mergeWorkspaces(rows []workspace) []workspace {
	merged := make(map[string]workspace, len(rows))
	for _, row := range rows {
		key := filepath.Clean(row.Path)
		previous, exists := merged[key]
		if !exists {
			merged[key] = row
			continue
		}
		merged[key] = mergeWorkspace(previous, row)
	}
	result := make([]workspace, 0, len(merged))
	for _, row := range merged {
		result = append(result, row)
	}
	sort.Slice(result, func(left int, right int) bool {
		if result[left].Repository != result[right].Repository {
			return result[left].Repository < result[right].Repository
		}
		if result[left].Path != result[right].Path {
			return result[left].Path < result[right].Path
		}
		return result[left].Source < result[right].Source
	})
	return result
}

func mergeWorkspace(left workspace, right workspace) workspace {
	if strings.Contains(right.Source, "jj") {
		left.Name = right.Name
		left.Commit = right.Commit
		left.jjName = right.jjName
		if left.Repository == "" {
			left.Repository = right.Repository
		}
	}
	if strings.Contains(right.Source, "git") {
		left.gitRepo = right.gitRepo
		if left.Repository == "" {
			left.Repository = right.Repository
		}
	}
	left.Source = mergeSource(left.Source, right.Source)
	left.LastChange = laterDate(left.LastChange, right.LastChange)
	left.Created = laterDate(left.Created, right.Created)
	if left.State == "dirty" || right.State == "dirty" {
		left.State = "dirty"
	} else if left.State == "unknown" || right.State == "unknown" {
		left.State = "unknown"
	} else {
		left.State = "clean"
	}
	return left
}

func mergeSource(left string, right string) string {
	if left == right || left == "jj+git" || right == "jj+git" {
		return left
	}
	return "jj+git"
}

func laterDate(left string, right string) string {
	if left == "" {
		return right
	}
	if right == "" || left >= right {
		return left
	}
	return right
}

func shortCommit(commit string) string {
	if len(commit) > 8 {
		return commit[:8]
	}
	return commit
}

func runCommand(name string, args ...string) ([]byte, error) {
	command := exec.Command(name, args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return nil, fmt.Errorf("%s: %w: %s", name, err, message)
		}
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return output, nil
}

func canonicalDirectory(path string) (string, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve root %q: %w", path, err)
	}
	resolvedPath, err := filepath.EvalSymlinks(absolutePath)
	if err != nil {
		return "", fmt.Errorf("root does not exist: %s", path)
	}
	info, err := os.Stat(resolvedPath)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("root is not a directory: %s", path)
	}
	return filepath.Clean(resolvedPath), nil
}

func normalizeWorkspacePath(path string) (string, error) {
	if path == "" {
		return "", errors.New("empty workspace path")
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	resolvedPath, err := filepath.EvalSymlinks(absolutePath)
	if err == nil {
		return filepath.Clean(resolvedPath), nil
	}
	return filepath.Clean(absolutePath), nil
}

func pathWithin(root string, path string, allowRoot bool) bool {
	relativePath, err := filepath.Rel(root, path)
	if err != nil || filepath.IsAbs(relativePath) {
		return false
	}
	if relativePath == "." {
		return allowRoot
	}
	return relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator))
}

func samePath(left string, right string) bool {
	return filepath.Clean(left) == filepath.Clean(right)
}

func directoryContains(parent string, child string) bool {
	return parent != "" && child != "" && pathWithin(parent, child, true)
}
