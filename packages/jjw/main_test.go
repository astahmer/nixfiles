package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestParseJJWorkspaceRecordsKeepsPathsWithTabs(t *testing.T) {
	values := []string{"workspace name", "/tmp/repo with space/has\ttab", "0123456789abcdef", "2026-09-23"}
	fields := make([]string, len(values))
	for index, value := range values {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		fields[index] = string(encoded)
	}
	records, err := parseJJWorkspaceRecords([]byte(strings.Join(fields, "\t")))
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("got %d records, want 1", len(records))
	}
	if records[0].Path != values[1] || records[0].Name != values[0] {
		t.Fatalf("got path %q and name %q", records[0].Path, records[0].Name)
	}
}

func TestParseGitWorktreeRecordsKeepsNewlinesAndSpaces(t *testing.T) {
	firstPath := "/tmp/repo with space/line\nbreak"
	output := []byte("worktree " + firstPath + "\x00HEAD abcdef012345\x00branch refs/heads/topic\x00\x00worktree /tmp/other\x00HEAD 123456789abc\x00\x00")
	worktrees, err := parseGitWorktreeRecords(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(worktrees) != 2 {
		t.Fatalf("got %d worktrees, want 2", len(worktrees))
	}
	if worktrees[0].Path != firstPath || worktrees[1].Commit != "123456789abc" {
		t.Fatalf("unexpected records: %#v", worktrees)
	}
}

func TestAgeInDaysUsesSelectedBasis(t *testing.T) {
	now := time.Date(2026, time.September, 24, 12, 0, 0, 0, time.Local)
	lastChangeAge := ageInDays("2026-09-23", "2026-08-25", "last-change", now)
	createdAge := ageInDays("2026-09-23", "2026-08-25", "created", now)
	if lastChangeAge == nil || *lastChangeAge != 1 {
		t.Fatalf("last-change age = %v, want 1", lastChangeAge)
	}
	if createdAge == nil || *createdAge != 30 {
		t.Fatalf("created age = %v, want 30", createdAge)
	}
}

func TestMergeWorkspacesDeduplicatesSamePath(t *testing.T) {
	rows := mergeWorkspaces([]workspace{
		{Source: "jj", Name: "topic", Repository: "/tmp/repo", Path: "/tmp/repo-topic", Commit: "jj123456", LastChange: "2026-09-20", Created: "2026-09-01", State: "clean", jjName: "topic"},
		{Source: "git", Name: "repo-topic", Repository: "/tmp/repo", Path: "/tmp/repo-topic", Commit: "git12345", LastChange: "2026-09-21", Created: "2026-09-02", State: "dirty", gitRepo: "/tmp/repo"},
	})
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if rows[0].Source != "jj+git" || rows[0].LastChange != "2026-09-21" || rows[0].Created != "2026-09-02" || rows[0].State != "dirty" {
		t.Fatalf("unexpected merged row: %#v", rows[0])
	}
}

func TestWorkspaceActionProtectsDirtyAndCurrentPaths(t *testing.T) {
	age := 40
	row := workspace{Path: "/tmp/repo/topic", Repository: "/tmp/repo", State: "clean", AgeDays: &age}
	if action := workspaceAction(row, "/tmp", 30); action != "review" {
		t.Fatalf("clean stale workspace action = %q, want review", action)
	}
	row.State = "dirty"
	if action := workspaceAction(row, "/tmp", 30); action != "protected-dirty" {
		t.Fatalf("dirty workspace action = %q, want protected-dirty", action)
	}
	row.State = "clean"
	if action := workspaceAction(row, "/tmp/repo/topic/subdir", 30); action != "protected-current" {
		t.Fatalf("current workspace action = %q, want protected-current", action)
	}
}

func TestPathWithinDoesNotMatchPrefixSibling(t *testing.T) {
	if !pathWithin("/tmp/dev", "/tmp/dev/project", false) {
		t.Fatal("expected nested path to be inside root")
	}
	if pathWithin("/tmp/dev", "/tmp/dev-old/project", false) {
		t.Fatal("prefix sibling must be outside root")
	}
}
