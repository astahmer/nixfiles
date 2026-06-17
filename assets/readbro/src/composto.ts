import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { findRepoRoot } from "./repo-root.ts";

export type CompostoIntent =
  | "refactor"
  | "bugfix"
  | "feature"
  | "test"
  | "docs"
  | "unknown";

export const runCompostoCli = (args: Array<string>, startPath = process.cwd()): string => {
  const cwd = findRepoRoot(resolve(startPath));
  const result = spawnSync("composto", args, {
    cwd,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, COMPOSTO_BLASTRADIUS: "1" },
  });

  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(output || `composto exited ${result.status}`);
  }
  return output;
};
