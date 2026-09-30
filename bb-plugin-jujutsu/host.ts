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
      if (code !== 0)
        reject(new Error(error.trim() || `jj ${args[0]} failed (${code ?? "signal"})`));
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

const revisionTemplate = String.raw`"{\"commitId\": " ++ json(commit_id.short(40)) ++ ", \"changeId\": " ++ json(change_id.short(40)) ++ ", \"changeIdPrefix\": " ++ json(change_id.shortest().prefix()) ++ ", \"empty\": " ++ self.empty() ++ ", \"description\": " ++ json(description) ++ ", \"timestamp\": " ++ committer.timestamp().format("%s") ++ ", \"parents\": " ++ json(parents.map(|c| c.commit_id().short(40))) ++ ", \"bookmarks\": " ++ json(bookmarks.map(|b| b.name())) ++ ", \"tags\": " ++ json(tags.map(|t| t.name())) ++ ", \"workspaces\": " ++ json(working_copies.map(|w| w.name())) ++ "}\n"`;

const parseRevisions = (raw: string) =>
  z.array(revisionSchema).parse(
    raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );

const listRevisions = async (root: string, pushedRevision: string | null) => {
  const raw = await run(root, [
    "log",
    "--no-graph",
    "-r",
    "all()",
    "-n",
    "500",
    "-T",
    revisionTemplate,
  ]);
  const revisions = parseRevisions(raw);
  if (!pushedRevision || revisions.some((revision) => revision.commitId === pushedRevision)) {
    return revisions;
  }
  const pushedRaw = await run(root, [
    "log",
    "--no-graph",
    "-r",
    pushedRevision,
    "-T",
    revisionTemplate,
  ]);
  const pushed = parseRevisions(pushedRaw)[0];
  if (pushed) revisions.push(pushed);
  return revisions;
};

const lastPush = async (root: string) => {
  const template = String.raw`json(id.short()) ++ "\t" ++ json(description) ++ "\t" ++ time.start().format("%s") ++ "\n"`;
  const rawOperations = await run(
    root,
    ["op", "log", "--no-graph", "-n", "500", "--at-op=@", "--ignore-working-copy", "-T", template],
    256_000,
  );
  for (const line of rawOperations.split("\n").filter(Boolean)) {
    const [operationId, rawDescription, rawTimestamp] = line.split("\t");
    if (!operationId || !rawDescription || !rawTimestamp) continue;
    const parsedOperationId = z.string().parse(JSON.parse(operationId));
    const description = z.string().parse(JSON.parse(rawDescription));
    if (!description.toLowerCase().startsWith("push ")) continue;
    const pushedRevisions = await run(
      root,
      [
        "log",
        "--no-graph",
        `--at-op=${parsedOperationId}`,
        "-r",
        "remote_bookmarks()",
        "-T",
        String.raw`commit_id.short(40) ++ "\n"`,
      ],
      64_000,
    );
    return {
      timestamp: Number(rawTimestamp),
      revision: pushedRevisions.split("\n").find(Boolean) ?? null,
    };
  }
  return null;
};

const parseFileChanges = (summary: string) =>
  summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 1),
      path: line.slice(1).trim(),
    }));

const changes = async (root: string) =>
  parseFileChanges(await run(root, ["diff", "--summary"], 64_000));

const workspaces = async (root: string) => {
  const template = String.raw`json(self.name()) ++ "\t" ++ json(self.root()) ++ "\t" ++ self.target().commit_id().short() ++ "\n"`;
  const raw = await run(root, ["workspace", "list", "-T", template]);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [rawName = '""', rawPath = "null", revision = ""] = line.split("\t");
      return {
        name: z.string().parse(JSON.parse(rawName)),
        path: z.string().nullable().parse(JSON.parse(rawPath)) ?? "",
        revision,
      };
    });
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    inspect: async ({ path }) => {
      const root = await repositoryRoot(path);
      const push = await lastPush(root);
      const [revisionList, currentRevision, fileChanges, workspaceList] = await Promise.all([
        listRevisions(root, push?.revision ?? null),
        run(root, ["log", "--no-graph", "-r", "@", "-T", "commit_id.short(40)"]).then((value) =>
          value.trim(),
        ),
        changes(root),
        workspaces(root),
      ]);
      return {
        root,
        currentRevision,
        lastPushAt: push?.timestamp ?? null,
        lastPushRevision: push?.revision ?? null,
        revisions: revisionList,
        changes: fileChanges,
        workspaces: workspaceList,
      };
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
    edit: async ({ path, revision }) => {
      await run(await repositoryRoot(path), ["edit", revision]);
      return { ok: true };
    },
    newChange: async ({ path, revision }) => {
      await run(await repositoryRoot(path), ["new", revision]);
      return { ok: true };
    },
    duplicate: async ({ path, revision }) => {
      await run(await repositoryRoot(path), ["duplicate", revision]);
      return { ok: true };
    },
    abandon: async ({ path, revision }) => {
      await run(await repositoryRoot(path), ["abandon", revision]);
      return { ok: true };
    },
    revert: async ({ path, revision, destination }) => {
      await run(await repositoryRoot(path), [
        "revert",
        "--revision",
        revision,
        "--onto",
        destination,
      ]);
      return { ok: true };
    },
    setBookmark: async ({ path, revision, name }) => {
      await run(await repositoryRoot(path), ["bookmark", "set", name, "--revision", revision]);
      return { ok: true };
    },
    rebase: async ({ path, revision, destination }) => {
      await run(await repositoryRoot(path), ["rebase", "-s", revision, "-d", destination]);
      return { ok: true };
    },
    squash: async ({ path, revision, destination }) => {
      await run(await repositoryRoot(path), [
        "squash",
        "--from",
        revision,
        "--into",
        destination,
        "--use-destination-message",
      ]);
      return { ok: true };
    },
    split: async ({ path, revision, files, message }) => {
      const filesets = files.map((file) => `root-file:${JSON.stringify(file)}`);
      await run(await repositoryRoot(path), [
        "split",
        "-r",
        revision,
        "--message",
        message,
        ...filesets,
      ]);
      return { ok: true };
    },
  },
});
