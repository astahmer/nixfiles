package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var version = "dev"

type options struct {
	root          string
	olderThanDays int
	withDefault   bool
	ageBasis      string
	format        string
	sortBy        string
	reverse       bool
	withSize      bool
	filter        string
	kind          string
	state         string
	action        string
	checkState    bool
	version       bool
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "jjw: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	command := "list"
	explicitCommand := len(args) > 0 && !strings.HasPrefix(args[0], "-")
	if explicitCommand {
		command = args[0]
		args = args[1:]
	} else if terminalAvailable() && !requestsListOutput(args) {
		command = "browse"
	}

	if command == "help" {
		printUsage(os.Stdout)
		return nil
	}
	if command != "list" && command != "browse" && command != "cleanup" {
		return fmt.Errorf("unknown command %q; use jjw help", command)
	}
	for _, argument := range args {
		if argument == "-h" || argument == "--help" {
			printCommandUsage(os.Stdout, command)
			return nil
		}
	}

	parsedOptions, err := parseOptions(command, args)
	if err != nil {
		return err
	}
	if parsedOptions.version {
		fmt.Fprintln(os.Stdout, version)
		return nil
	}

	if command == "cleanup" {
		if parsedOptions.format != "table" {
			return errors.New("--format only applies to jjw list")
		}
		return cleanup(parsedOptions)
	}
	if command == "browse" {
		return runBrowser(parsedOptions)
	}

	rows, warnings, err := scanWorkspaces(parsedOptions)
	if err != nil {
		return err
	}
	printWarnings(warnings)
	rows = filterWorkspaces(rows, parsedOptions)
	if parsedOptions.withSize {
		printWarnings(populateWorkspaceSizes(rows))
	}
	sortWorkspaces(rows, parsedOptions)
	return renderReport(os.Stdout, rows, parsedOptions)
}

func requestsListOutput(args []string) bool {
	for _, argument := range args {
		if argument == "--format" || strings.HasPrefix(argument, "--format=") {
			return true
		}
	}
	return false
}

func parseOptions(command string, args []string) (options, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return options{}, fmt.Errorf("find home directory: %w", err)
	}
	defaultRoot := os.Getenv("JJ_WORKSPACE_ROOT")
	if defaultRoot == "" {
		defaultRoot = filepath.Join(home, "dev")
	}
	olderThanDays := 30
	if value := os.Getenv("JJ_WORKSPACE_OLDER_THAN_DAYS"); value != "" {
		parsed, parseErr := strconv.Atoi(value)
		if parseErr != nil || parsed < 0 {
			return options{}, fmt.Errorf("JJ_WORKSPACE_OLDER_THAN_DAYS must be a non-negative integer, got %q", value)
		}
		olderThanDays = parsed
	}

	parsedOptions := options{
		root:          defaultRoot,
		olderThanDays: olderThanDays,
		ageBasis:      "last-change",
		format:        "table",
	}
	flags := flag.NewFlagSet("jjw "+command, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.Usage = func() { printCommandUsage(os.Stderr, command) }
	flags.StringVar(&parsedOptions.root, "root", parsedOptions.root, "directory to scan (default: $HOME/dev)")
	flags.IntVar(&parsedOptions.olderThanDays, "older-than-days", parsedOptions.olderThanDays, "mark workspaces for review at this age")
	flags.BoolVar(&parsedOptions.withDefault, "with-default", false, "include the default JJ workspace")
	flags.StringVar(&parsedOptions.ageBasis, "age-basis", parsedOptions.ageBasis, "age by last-change (default) or created")
	if command == "list" || command == "browse" {
		if command == "list" {
			flags.StringVar(&parsedOptions.format, "format", parsedOptions.format, "list output: table, json, tsv, or csv")
		}
		flags.StringVar(&parsedOptions.sortBy, "sort", "", "sort by last-change, age, created, size, name, repository, state, or action")
		flags.BoolVar(&parsedOptions.reverse, "reverse", false, "reverse the selected sort order")
		flags.BoolVar(&parsedOptions.withSize, "size", false, "measure workspace contents and show their size (slower)")
	}
	flags.StringVar(&parsedOptions.filter, "filter", "", "case-insensitive substring filter across name, repository, and path")
	flags.StringVar(&parsedOptions.kind, "kind", "", "filter by source: jj or git")
	flags.StringVar(&parsedOptions.state, "state", "", "filter by state: clean, dirty, or unknown")
	flags.StringVar(&parsedOptions.action, "action", "", "filter by action: recent, review, or protected")
	flags.BoolVar(&parsedOptions.checkState, "check-state", false, "check every workspace for dirty files (slower)")
	flags.BoolVar(&parsedOptions.version, "version", false, "print version")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return options{}, nil
		}
		return options{}, err
	}
	if flags.NArg() > 0 {
		return options{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if parsedOptions.olderThanDays < 0 {
		return options{}, errors.New("--older-than-days must be a non-negative integer")
	}
	if parsedOptions.ageBasis != "last-change" && parsedOptions.ageBasis != "created" {
		return options{}, errors.New("--age-basis must be last-change or created")
	}
	if command == "list" && parsedOptions.format != "table" && parsedOptions.format != "json" && parsedOptions.format != "tsv" && parsedOptions.format != "csv" {
		return options{}, errors.New("--format must be table, json, tsv, or csv")
	}
	if command == "list" || command == "browse" {
		switch parsedOptions.sortBy {
		case "", "last-change", "age", "created", "size", "name", "repository", "state", "action":
		default:
			return options{}, errors.New("--sort must be last-change, age, created, size, name, repository, state, or action")
		}
		if parsedOptions.reverse && parsedOptions.sortBy == "" {
			return options{}, errors.New("--reverse requires --sort")
		}
		if parsedOptions.sortBy == "size" {
			parsedOptions.withSize = true
		}
		if parsedOptions.sortBy == "state" || parsedOptions.sortBy == "action" {
			parsedOptions.checkState = true
		}
	}
	if parsedOptions.kind != "" && parsedOptions.kind != "jj" && parsedOptions.kind != "git" {
		return options{}, errors.New("--kind must be jj or git")
	}
	if parsedOptions.state != "" && parsedOptions.state != "clean" && parsedOptions.state != "dirty" && parsedOptions.state != "unknown" {
		return options{}, errors.New("--state must be clean, dirty, or unknown")
	}
	if parsedOptions.action != "" && parsedOptions.action != "recent" && parsedOptions.action != "review" && parsedOptions.action != "protected" {
		return options{}, errors.New("--action must be recent, review, or protected")
	}
	if parsedOptions.state != "" || parsedOptions.action != "" {
		parsedOptions.checkState = true
	}
	return parsedOptions, nil
}

func printUsage(writer io.Writer) {
	fmt.Fprintf(writer, `jjw %s — browse and audit JJ workspaces and Git worktrees

Usage:
  jjw [browse|list] [flags]
  jjw cleanup [flags]

Commands:
  browse    Interactive workspace browser (default in a terminal)
  list      Print a table, JSON, TSV, or CSV report (default without a terminal)
  cleanup   Filter and remove selected stale workspaces with fzf
  help      Show this help

Run jjw browse --help, jjw list --help, or jjw cleanup --help for command flags.
`, version)
}

func printCommandUsage(writer io.Writer, command string) {
	if command == "cleanup" {
		fmt.Fprintln(writer, "Usage: jjw cleanup [flags]")
		fmt.Fprintln(writer, "Select entries with fzf. Cleanliness and age are rechecked before removal.")
	} else if command == "browse" {
		fmt.Fprintln(writer, "Usage: jjw browse [flags]")
		fmt.Fprintln(writer, "Open an interactive workspace browser. Dirty state and sizes load on demand.")
	} else {
		fmt.Fprintln(writer, "Usage: jjw list [flags]")
		fmt.Fprintln(writer, "Prints a fast table by default. Use --check-state for full dirty-state checks.")
	}
	fmt.Fprintln(writer, "Flags:")
	fmt.Fprintln(writer, "  --root PATH              Directory to scan (default: $HOME/dev)")
	fmt.Fprintln(writer, "  --older-than-days N      Mark workspaces for review at this age (default: 30)")
	fmt.Fprintln(writer, "  --age-basis BASIS        last-change (default) or created")
	fmt.Fprintln(writer, "  --with-default           Include the default JJ workspace")
	if command == "list" || command == "browse" {
		if command == "list" {
			fmt.Fprintln(writer, "  --format FORMAT          table (default), json, tsv, or csv")
		}
		fmt.Fprintln(writer, "  --sort FIELD             last-change, age, created, size, name, repository, state, or action")
		fmt.Fprintln(writer, "  --reverse                Reverse selected sort order")
		fmt.Fprintln(writer, "  --size                   Measure workspace contents and show size (slower)")
	}
	fmt.Fprintln(writer, "  --filter TEXT            Case-insensitive filter across name, repository, and path")
	fmt.Fprintln(writer, "  --kind SOURCE            jj or git")
	fmt.Fprintln(writer, "  --state STATE            clean, dirty, or unknown")
	fmt.Fprintln(writer, "  --action ACTION          recent, review, or protected")
	fmt.Fprintln(writer, "  --check-state            Check every workspace for dirty files (slower)")
	fmt.Fprintln(writer, "  --version                Print version")
}

func printWarnings(warnings []string) {
	for _, warning := range warnings {
		fmt.Fprintf(os.Stderr, "jjw: warning: %s\n", warning)
	}
}
