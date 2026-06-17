import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { repoDbPath } from "../src/cache.ts";
import { isWorkingCopyRoot, workingCopyKind, findRepoRoot } from "../src/repo-root.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-repo-root-"));

const layout = (
  name: string,
  dirs: Array<string>,
  files: Record<string, string> = {},
) => {
  const root = join(tmp, name);
  for (const rel of dirs) mkdirSync(join(root, rel), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
};

test("git clone: .git directory", () => {
  const root = layout("git-clone", [".git/objects", "src"]);
  const file = join(root, "src", "app.ts");
  writeFileSync(file, "export {};\n");

  assert.equal(findRepoRoot(file), root);
  assert.equal(workingCopyKind(root), "git");
  assert.equal(isWorkingCopyRoot(root), true);
});

test("git worktree: .git file", () => {
  const main = layout("git-main", [".git/worktrees/feature", "src"]);
  const worktree = layout("git-worktree", ["src"]);
  writeFileSync(
    join(worktree, ".git"),
    `gitdir: ${join(main, ".git", "worktrees", "feature")}\n`,
  );
  const file = join(worktree, "src", "app.ts");
  writeFileSync(file, "export {};\n");

  assert.equal(findRepoRoot(file), worktree);
  assert.notEqual(findRepoRoot(file), main);
});

test("jj repo: .jj only", () => {
  const root = layout("jj-only", [".jj/repo/store", "src"]);
  const file = join(root, "src", "lib.rs");
  writeFileSync(file, "fn main() {}\n");

  assert.equal(findRepoRoot(file), root);
  assert.equal(workingCopyKind(root), "jj");
});

test("jj workspace sibling", () => {
  const main = layout("jj-main", [".jj/repo/store", "src"]);
  const ws = layout("jj-ws", ["src"]);
  mkdirSync(join(ws, ".jj"), { recursive: true });
  writeFileSync(join(ws, ".jj", "repo"), `../../../jj-main/.jj/repo\n`);
  const file = join(ws, "src", "other.rs");
  writeFileSync(file, "fn other() {}\n");

  assert.equal(findRepoRoot(file), ws);
  assert.notEqual(findRepoRoot(file), main);
});

test("repoDbPath uses working-copy root per worktree", () => {
  const main = layout("db-main", [".git/worktrees/wt", "src"]);
  const worktree = layout("db-wt", ["src"]);
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  const file = join(worktree, "src", "a.ts");
  writeFileSync(file, "x\n");

  assert.equal(repoDbPath(file), join(worktree, ".readbro", "cache.db"));
});

rmSync(tmp, { recursive: true, force: true });
