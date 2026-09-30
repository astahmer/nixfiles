import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, secretEntrySchema } from "./contract";
import { z } from "zod";

const runSecret = async (
  cwd: string,
  args: string[],
  signal: AbortSignal,
  stdin?: string,
  maxBytes = 1_000_000,
): Promise<string> => {
  const directory = resolve(cwd);
  await access(directory, constants.R_OK);
  if (signal.aborted) throw new Error("Secret CLI request was cancelled.");
  return new Promise((resolveOutput, reject) => {
    const child = spawn("secret", args, {
      cwd: directory,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      child.kill("SIGTERM");
      reject(new Error("Could not capture secret CLI output."));
      return;
    }
    const stdinStream = stdin === undefined ? undefined : child.stdin;
    if (stdin !== undefined && !stdinStream) {
      child.kill("SIGTERM");
      reject(new Error("Could not send the value to secret CLI stdin."));
      return;
    }
    let output = "";
    let error = "";
    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxBytes) child.kill("SIGTERM");
    });
    stderr.on("data", (chunk: string) => {
      error += chunk;
      if (Buffer.byteLength(error) > 8_000) child.kill("SIGTERM");
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 45_000);
    const abortChild = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abortChild, { once: true });
    if (signal.aborted) abortChild();
    if (stdin !== undefined) stdinStream?.end(stdin);
    child.once("error", (cause) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortChild);
      reject(new Error(`Could not start secret CLI: ${cause.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortChild);
      if (signal.aborted) {
        reject(new Error("Secret CLI request was cancelled."));
        return;
      }
      if (code !== 0)
        reject(new Error(error.trim() || `secret ${args[0]} failed (${code ?? "signal"})`));
      else resolveOutput(output);
    });
  });
};

const listEntries = async (
  cwd: string | undefined,
  scope: "all" | "project" | "global" | "local",
  signal: AbortSignal,
) => {
  const args = scope === "all" ? ["print", "--all", "--json"] : ["print", scope, "--json"];
  const output = await runSecret(cwd ?? "/", args, signal);
  const entries = z
    .array(secretEntrySchema.omit({ scope: true }).extend({ scope: z.string().optional() }))
    .max(2000)
    .parse(JSON.parse(output));
  return entries.map((entry) => ({
    ...entry,
    scope: entry.scope ?? (scope === "all" ? "global" : scope),
  }));
};

const environmentArguments = (environment: string) => ["--env", environment];
const scopeArguments = (scope: "project" | "global" | "local" | undefined, cwd: string) => {
  if (scope === "global") return ["--config", join(homedir(), ".config/secret/config.json")];
  if (scope === "local") return ["--config", join(cwd, ".secret.local.json")];
  return [];
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: async ({ cwd, scope }, context) => ({
      entries: await listEntries(cwd, scope, context.signal),
    }),
    get: async ({ cwd, alias, environment, scope }, context) => {
      const output = await runSecret(
        cwd,
        [...scopeArguments(scope, cwd), ...environmentArguments(environment), "get", alias],
        context.signal,
      );
      return { value: output.endsWith("\n") ? output.slice(0, -1) : output };
    },
    copy: async ({ cwd, alias, environment, scope }, context) => {
      const output = await runSecret(
        cwd,
        [
          ...scopeArguments(scope, cwd),
          ...environmentArguments(environment),
          "get",
          alias,
          "--copy",
        ],
        context.signal,
      );
      return { message: output.trim() || `Copied ${alias} to the selected host clipboard.` };
    },
    set: async ({ cwd, alias, value, environment, scope, itemType }, context) => {
      const args = [
        ...scopeArguments(scope, cwd),
        ...environmentArguments(environment),
        "set",
        alias,
        "--force",
      ];
      if (itemType) args.push("--type", itemType);
      const output = await runSecret(cwd, args, context.signal, value);
      return { message: output.trim() || `Saved ${alias} through the secret CLI.` };
    },
    rename: async ({ cwd, alias, newAlias, scope }, context) => {
      const args = [...scopeArguments(scope, cwd ?? "/"), "mv", alias, newAlias];
      const output = await runSecret(cwd ?? "/", args, context.signal);
      return { message: output.trim() || `Renamed ${alias} to ${newAlias}.` };
    },
    unset: async ({ cwd, alias, scope }, context) => {
      const args = [...scopeArguments(scope, cwd ?? "/"), "unset", alias];
      const output = await runSecret(cwd ?? "/", args, context.signal);
      return { message: output.trim() || `Removed ${alias} from ${scope} aliases.` };
    },
  },
});
