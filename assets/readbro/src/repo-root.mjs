import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Working-copy root — where checked-out files live.
 *
 * - git clone: `.git/` directory
 * - git worktree: `.git` file → `gitdir: …/worktrees/<name>` (still this directory)
 * - git submodule: `.git` file → `gitdir: …/modules/<name>`
 * - jj repo / workspace: `.jj/` (main colocation or `jj workspace add` sibling)
 */
export function isWorkingCopyRoot(dir) {
  if (existsSync(join(dir, ".jj"))) return true;
  return existsSync(join(dir, ".git"));
}

/** @returns {"jj+git" | "jj" | "git" | null} */
export function workingCopyKind(dir) {
  const hasJj = existsSync(join(dir, ".jj"));
  const hasGit = existsSync(join(dir, ".git"));
  if (hasJj && hasGit) return "jj+git";
  if (hasJj) return "jj";
  if (hasGit) return "git";
  return null;
}

/**
 * Innermost working-copy root containing `filePath`.
 * Each git worktree and jj workspace gets its own root (and thus its own `.readbro/`).
 */
export function findRepoRoot(filePath) {
  let dir = resolve(filePath);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);

  while (dir !== dirname(dir)) {
    if (isWorkingCopyRoot(dir)) return dir;
    dir = dirname(dir);
  }

  return dirname(resolve(filePath));
}
