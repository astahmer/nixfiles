import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, revisionSchema } from "./contract";
import { z } from "zod";

const run = async (cwd: string, args: string[], maxBytes = 2_000_000): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const process = spawn("jj", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxBytes) process.kill("SIGTERM");
    });
    process.stderr.on("data", (chunk: string) => {
      error += chunk;
      if (Buffer.byteLength(error) > 32_000) process.kill("SIGTERM");
    });
    const timeout = setTimeout(() => process.kill("SIGTERM"), 15_000);
    process.once("error", (cause) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start jj: ${cause.message}`));
    });
    process.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(error.trim() || `jj ${args[0]} failed (${code ?? "signal"})`));
      else resolveOutput(output);
    });
  });

const repositoryRoot = async (inputPath: string): Promise<string> => {
  const requestedPath = resolve(inputPath);
  await access(requestedPath, constants.R_OK);
  const root = (await run(requestedPath, ["root"])).trim();
  if (root === "") throw new Error("Selected folder is not inside a jj repository.");
  return realpath(root);
};

const listRevisions = async (root: string) => {
  const template = String.raw`"{\"commitId\": " ++ json(commit_id.short()) ++ ", \"changeId\": " ++ json(change_id.short()) ++ ", \"description\": " ++ json(description) ++ ", \"timestamp\": " ++ committer.timestamp().format("%s") ++ ", \"parents\": " ++ json(parents.map(|c| c.commit_id().short())) ++ ", \"bookmarks\": " ++ json(bookmarks.map(|b| b.name())) ++ ", \"tags\": " ++ json(tags.map(|t| t.name())) ++ ", \"workspaces\": " ++ json(working_copies.map(|w| w.name())) ++ "}\n"`;
  const raw = await run(root, ["log", "--no-graph", "-r", "all()", "-n", "500", "-T", template]);
  return z.array(revisionSchema).parse(raw.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
};

const parseFileChanges = (summary: string) => summary.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => ({
  status: line.slice(0, 1),
  path: line.slice(1).trim(),
}));

const changes = async (root: string) => parseFileChanges(await run(root, ["diff", "--summary"], 64_000));

const workspaces = async (root: string) => {
  const template = String.raw`json(self.name()) ++ "\t" ++ json(self.root()) ++ "\t" ++ self.target().commit_id().short() ++ "\n"`;
  const raw = await run(root, ["workspace", "list", "-T", template]);
  return raw.split("\n").filter(Boolean).map((line) => {
    const [rawName = "\"\"", rawPath = "null", revision = ""] = line.split("\t");
    return { name: z.string().parse(JSON.parse(rawName)), path: z.string().nullable().parse(JSON.parse(rawPath)) ?? "", revision };
  });
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    inspect: async ({ path }) => {
      const root = await repositoryRoot(path);
      const [revisionList, currentRevision, fileChanges, workspaceList] = await Promise.all([
        listRevisions(root),
        run(root, ["log", "--no-graph", "-r", "@", "-T", "commit_id.short()"]).then((value) => value.trim()),
        changes(root),
        workspaces(root),
      ]);
      return { root, currentRevision, revisions: revisionList, changes: fileChanges, workspaces: workspaceList };
    },
    revisionFiles: async ({ path, revision }) => {
      const root = await repositoryRoot(path);
      const summary = await run(root, ["diff", "--summary", "-r", revision], 64_000);
      return parseFileChanges(summary);
    },
    fileDiff: async ({ path, file, revision }) => {
      const root = await repositoryRoot(path);
      const args = ["diff", "--git"];
      if (revision) args.push("-r", revision);
      args.push(`root-file:${JSON.stringify(file)}`);
      return { patch: await run(root, args, 1_000_000) };
    },
    describe: async ({ path, revision, description }) => {
      await run(await repositoryRoot(path), ["describe", "-r", revision, "-m", description]);
      return { ok: true };
    },
    rebase: async ({ path, revision, destination }) => {
      await run(await repositoryRoot(path), ["rebase", "-s", revision, "-d", destination]);
      return { ok: true };
    },
    squash: async ({ path, revision, destination }) => {
      await run(await repositoryRoot(path), ["squash", "--from", revision, "--into", destination, "--use-destination-message"]);
      return { ok: true };
    },
    split: async ({ path, revision, files, message }) => {
      const filesets = files.map((file) => `root-file:${JSON.stringify(file)}`);
      await run(await repositoryRoot(path), ["split", "-r", revision, "--message", message, ...filesets]);
      return { ok: true };
    },
  },
});
