import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const repositoryInput = z.object({ path: z.string().trim().min(1).max(4096) });
const revisionInput = repositoryInput.extend({ revision: z.string().min(1).max(128) });

export const revisionSchema = z.object({
  commitId: z.string(),
  changeId: z.string(),
  description: z.string(),
  parents: z.array(z.string()),
  bookmarks: z.array(z.string()),
  tags: z.array(z.string()),
  workspaces: z.array(z.string()),
});

export const fileChangeSchema = z.object({ path: z.string(), status: z.string() });

export const hostContract = defineRpcContract({
  inspect: {
    input: repositoryInput,
    output: z.object({
      root: z.string(),
      currentRevision: z.string(),
      revisions: z.array(revisionSchema),
      changes: z.array(fileChangeSchema),
      workspaces: z.array(z.object({ name: z.string(), path: z.string(), revision: z.string() })),
      diff: z.string(),
    }),
  },
  diff: {
    input: revisionInput,
    output: z.object({ diff: z.string(), files: z.array(z.string()) }),
  },
  describe: {
    input: revisionInput.extend({ description: z.string().max(10000) }),
    output: z.object({ ok: z.boolean() }),
  },
  rebase: {
    input: revisionInput.extend({ destination: z.string().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  squash: {
    input: revisionInput.extend({ destination: z.string().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  split: {
    input: revisionInput.extend({ files: z.array(z.string().min(1).max(4096)).min(1).max(100), message: z.string().max(10000) }),
    output: z.object({ ok: z.boolean() }),
  },
});
