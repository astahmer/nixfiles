import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Working-copy root: git clone/worktree/submodule or jj repo/workspace. */
export const isWorkingCopyRoot = (dir: string): boolean =>
  existsSync(join(dir, ".jj")) || existsSync(join(dir, ".git"));

export type WorkingCopyKind = "jj+git" | "jj" | "git" | null;

export const workingCopyKind = (dir: string): WorkingCopyKind => {
  const hasJj = existsSync(join(dir, ".jj"));
  const hasGit = existsSync(join(dir, ".git"));
  if (hasJj && hasGit) return "jj+git";
  if (hasJj) return "jj";
  if (hasGit) return "git";
  return null;
};

/** Innermost working-copy root containing `filePath`. */
export const findRepoRoot = (filePath: string): string => {
  let dir = resolve(filePath);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);

  while (dir !== dirname(dir)) {
    if (isWorkingCopyRoot(dir)) return dir;
    dir = dirname(dir);
  }

  return dirname(resolve(filePath));
};
