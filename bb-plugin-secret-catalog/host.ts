import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, secretEntrySchema } from "./contract";
import { z } from "zod";

const runSecret = async (
  cwd: string,
  args: string[],
  signal: AbortSignal,
  maxBytes = 1_000_000,
): Promise<string> => {
  const directory = resolve(cwd);
  await access(directory, constants.R_OK);
  if (signal.aborted) throw new Error("Secret CLI request was cancelled.");
  return new Promise((resolveOutput, reject) => {
    const child = spawn("secret", args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxBytes) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      error += chunk;
      if (Buffer.byteLength(error) > 8_000) child.kill("SIGTERM");
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 45_000);
    const abortChild = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abortChild, { once: true });
    if (signal.aborted) abortChild();
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

const listEntries = async (cwd: string, signal: AbortSignal) => {
  const output = await runSecret(cwd, ["print", "--all", "--json"], signal);
  return z.array(secretEntrySchema).max(2000).parse(JSON.parse(output));
};

const environmentArguments = (environment: string) => ["--env", environment];

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: async ({ cwd }, context) => ({ entries: await listEntries(cwd, context.signal) }),
    get: async ({ cwd, alias, environment }, context) => {
      const output = await runSecret(
        cwd,
        [...environmentArguments(environment), "get", alias],
        context.signal,
      );
      return { value: output.endsWith("\n") ? output.slice(0, -1) : output };
    },
    copy: async ({ cwd, alias, environment }, context) => {
      const output = await runSecret(
        cwd,
        [...environmentArguments(environment), "get", alias, "--copy"],
        context.signal,
      );
      return { message: output.trim() || `Copied ${alias} to the selected host clipboard.` };
    },
  },
});
