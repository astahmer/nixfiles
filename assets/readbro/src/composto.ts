import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { CompostoCommandError, CompostoSpawnError } from "./errors.ts";
import { findRepoRoot } from "./repo-root.ts";

export type CompostoIntent =
  | "refactor"
  | "bugfix"
  | "feature"
  | "test"
  | "docs"
  | "unknown";

const COMPOSTO_TIMEOUT_MS = 120_000;

const compostoEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  COMPOSTO_BLASTRADIUS: "1",
});

const finishComposto = (
  cwd: string,
  args: Array<string>,
  status: number | null,
  stdout: string,
  stderr: string,
): string => {
  const output = `${stdout}${stderr}`.trim();
  if (status !== 0) {
    throw new CompostoCommandError({
      command: "composto",
      args,
      cwd,
      exitCode: status,
      output,
    });
  }
  return output;
};

export const runCompostoCli = (args: Array<string>, startPath = process.cwd()): string => {
  const cwd = findRepoRoot(resolve(startPath));
  const result = spawnSync("composto", args, {
    cwd,
    encoding: "utf-8",
    timeout: COMPOSTO_TIMEOUT_MS,
    env: compostoEnv(),
  });

  if (result.error) {
    throw new CompostoSpawnError({
      command: "composto",
      cwd,
      cause: result.error,
    });
  }
  return finishComposto(cwd, args, result.status, result.stdout ?? "", result.stderr ?? "");
};

export const runCompostoCliAsync = (
  args: Array<string>,
  startPath = process.cwd(),
): Promise<string> => {
  const cwd = findRepoRoot(resolve(startPath));
  return new Promise((resolvePromise, reject) => {
    const child = spawn("composto", args, {
      cwd,
      env: compostoEnv(),
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new CompostoSpawnError({
          command: "composto",
          cwd,
          cause: new Error(`timed out after ${COMPOSTO_TIMEOUT_MS}ms`),
        }),
      );
    }, COMPOSTO_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new CompostoSpawnError({
          command: "composto",
          cwd,
          cause: error,
        }),
      );
    });

    child.on("close", (status) => {
      clearTimeout(timer);
      try {
        resolvePromise(finishComposto(cwd, args, status, stdout, stderr));
      } catch (error) {
        reject(error);
      }
    });
  });
};

export const runCompostoCliAll = (
  calls: ReadonlyArray<{ readonly args: Array<string>; readonly startPath?: string }>,
): Promise<ReadonlyArray<string>> =>
  Promise.all(calls.map((call) => runCompostoCliAsync(call.args, call.startPath)));
