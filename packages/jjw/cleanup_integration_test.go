package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestDeleteJJWorkspaceRechecksDirtyState(t *testing.T) {
	if _, err := exec.LookPath("jj"); err != nil {
		t.Skip("jj is unavailable")
	}
	root := t.TempDir()
	repository := filepath.Join(root, "repo")
	if _, err := runCommand("jj", "git", "init", "--no-colocate", repository); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(repository, ".jj", "repo", "config.toml")
	config := "[user]\nname = \"jjw test\"\nemail = \"jjw@example.invalid\"\n"
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	workspacePath := filepath.Join(root, "stale")
	if _, err := runCommand("jj", "-R", repository, "workspace", "add", "--name", "stale", workspacePath); err != nil {
		t.Fatal(err)
	}
	workspacePath, err := normalizeWorkspacePath(workspacePath)
	if err != nil {
		t.Fatal(err)
	}
	row := workspace{
		Source:     "jj",
		Name:       "stale",
		Repository: repository,
		Path:       workspacePath,
		State:      "clean",
		jjName:     "stale",
	}
	untrackedPath := filepath.Join(workspacePath, "keep.txt")
	if err := os.WriteFile(untrackedPath, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	cleanupOptions := options{root: root, ageBasis: "last-change"}
	if err := deleteWorkspace(cleanupOptions, row); err == nil {
		t.Fatal("expected untracked changes to protect the workspace")
	}
	if _, err := os.Stat(untrackedPath); err != nil {
		t.Fatalf("untracked file was removed: %v", err)
	}
	if err := os.Remove(untrackedPath); err != nil {
		t.Fatal(err)
	}
	if err := deleteWorkspace(cleanupOptions, row); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(workspacePath); !os.IsNotExist(err) {
		t.Fatalf("workspace still exists: %v", err)
	}
	repositoryOutput, err := runCommand("jj", "--ignore-working-copy", "-R", repository, "workspace", "list", "--template", jjWorkspaceTemplate)
	if err != nil {
		t.Fatal(err)
	}
	records, err := parseJJWorkspaceRecords(repositoryOutput)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.Name == "stale" {
			t.Fatal("forgotten JJ workspace is still registered")
		}
	}
}

func TestDeleteGitWorktreeRemovesRegisteredPath(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root := t.TempDir()
	root, err := canonicalDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	repository := filepath.Join(root, "repo")
	if err := os.MkdirAll(repository, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := runCommand("git", "-C", repository, "init"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repository, "README.md"), []byte("test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := runCommand("git", "-C", repository, "add", "README.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := runCommand("git", "-C", repository, "-c", "user.name=jjw test", "-c", "user.email=jjw@example.invalid", "commit", "-m", "initial"); err != nil {
		t.Fatal(err)
	}
	worktreePath := filepath.Join(root, "stale")
	if _, err := runCommand("git", "-C", repository, "worktree", "add", "--detach", worktreePath, "HEAD"); err != nil {
		t.Fatal(err)
	}
	worktreePath, err = normalizeWorkspacePath(worktreePath)
	if err != nil {
		t.Fatal(err)
	}
	rows, warnings := scanGitWorktrees(root)
	if len(warnings) > 0 {
		t.Fatalf("scan warnings: %v", warnings)
	}
	var selected workspace
	for _, row := range rows {
		if samePath(row.Path, worktreePath) {
			selected = row
		}
	}
	if selected.Path == "" {
		output, listErr := runCommand("git", "-C", repository, "worktree", "list", "--porcelain", "-z")
		t.Fatalf("new Git worktree was not found: rows=%#v, raw=%q, err=%v", rows, output, listErr)
	}
	if selected.State != "clean" {
		t.Fatalf("new Git worktree state = %q, want clean", selected.State)
	}
	if err := deleteWorkspace(options{root: root, ageBasis: "last-change"}, selected); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Fatalf("Git worktree still exists: %v", err)
	}
}
