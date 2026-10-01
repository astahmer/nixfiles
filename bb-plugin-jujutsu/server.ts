import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  revisionSchema,
  fileChangeSchema,
  fileStatSchema,
  workspaceCleanupCandidateSchema,
} from "./contract";

const target = z.object({ hostId: z.string().min(1), path: z.string().trim().min(1).max(4096) });
const revisionTarget = target.extend({ revision: z.string().min(1).max(128) });
const fileDiffTarget = target.extend({
  file: z.string().min(1).max(4096),
  revision: z.string().min(1).max(128).optional(),
});

export const rpcContract = defineRpcContract({
  inspect: {
    input: target,
    output: z.object({
      root: z.string(),
      currentRevision: z.string(),
      lastPushAt: z.number().nullable(),
      lastPushRevision: z.string().nullable(),
      revisions: z.array(revisionSchema),
      changes: z.array(fileChangeSchema),
      workspaces: z.array(z.object({ name: z.string(), path: z.string(), revision: z.string() })),
    }),
  },
  revisionFiles: { input: revisionTarget, output: z.array(fileChangeSchema) },
  revisionFileStats: { input: revisionTarget, output: z.array(fileStatSchema) },
  fileDiff: { input: fileDiffTarget, output: z.object({ patch: z.string() }) },
  describe: {
    input: revisionTarget.extend({ description: z.string().max(10000) }),
    output: z.object({ ok: z.boolean() }),
  },
  edit: { input: revisionTarget, output: z.object({ ok: z.boolean() }) },
  newChange: { input: revisionTarget, output: z.object({ ok: z.boolean() }) },
  duplicate: { input: revisionTarget, output: z.object({ ok: z.boolean() }) },
  abandon: { input: revisionTarget, output: z.object({ ok: z.boolean() }) },
  revert: {
    input: revisionTarget.extend({ destination: z.string().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  setBookmark: {
    input: revisionTarget.extend({ name: z.string().trim().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  moveBookmark: {
    input: target.extend({ name: z.string().trim().min(1).max(128), destination: z.string().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteBookmark: {
    input: target.extend({ name: z.string().trim().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  pushBookmark: {
    input: target.extend({ name: z.string().trim().min(1).max(128) }),
    output: z.object({ ok: z.boolean() }),
  },
  untrackBookmark: {
    input: target.extend({
      name: z.string().trim().min(1).max(128),
      remote: z.string().trim().min(1).max(128),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  rebase: {
    input: revisionTarget.extend({ destination: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  squash: {
    input: revisionTarget.extend({ destination: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  split: {
    input: revisionTarget.extend({
      files: z.array(z.string()).min(1).max(100),
      message: z.string().max(10000),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  clearEmptyAncestors: {
    input: target,
    output: z.object({ cleared: z.number().int().nonnegative() }),
  },
  outdatedWorkspaces: { input: target, output: z.array(workspaceCleanupCandidateSchema) },
  clearOutdatedWorkspaces: {
    input: target.extend({
      workspaces: z.array(z.object({ name: z.string(), path: z.string() })).min(1).max(50),
    }),
    output: z.object({ removed: z.array(z.string()), skipped: z.number().int().nonnegative() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    inspect: async (input) => host.call("inspect", { path: input.path }, { hostId: input.hostId }),
    revisionFiles: async (input) =>
      host.call(
        "revisionFiles",
        { path: input.path, revision: input.revision },
        { hostId: input.hostId },
      ),
    revisionFileStats: async (input) =>
      host.call(
        "revisionFileStats",
        { path: input.path, revision: input.revision },
        { hostId: input.hostId },
      ),
    fileDiff: async (input) =>
      host.call(
        "fileDiff",
        { path: input.path, file: input.file, revision: input.revision },
        { hostId: input.hostId },
      ),
    describe: async (input) => host.call("describe", input, { hostId: input.hostId }),
    edit: async (input) => host.call("edit", input, { hostId: input.hostId }),
    newChange: async (input) => host.call("newChange", input, { hostId: input.hostId }),
    duplicate: async (input) => host.call("duplicate", input, { hostId: input.hostId }),
    abandon: async (input) => host.call("abandon", input, { hostId: input.hostId }),
    revert: async (input) => host.call("revert", input, { hostId: input.hostId }),
    setBookmark: async (input) => host.call("setBookmark", input, { hostId: input.hostId }),
    moveBookmark: async (input) => host.call("moveBookmark", input, { hostId: input.hostId }),
    deleteBookmark: async (input) => host.call("deleteBookmark", input, { hostId: input.hostId }),
    pushBookmark: async (input) => host.call("pushBookmark", input, { hostId: input.hostId }),
    untrackBookmark: async (input) => host.call("untrackBookmark", input, { hostId: input.hostId }),
    rebase: async (input) => host.call("rebase", input, { hostId: input.hostId }),
    squash: async (input) => host.call("squash", input, { hostId: input.hostId }),
    split: async (input) => host.call("split", input, { hostId: input.hostId }),
    clearEmptyAncestors: async (input) =>
      host.call("clearEmptyAncestors", { path: input.path }, { hostId: input.hostId }),
    outdatedWorkspaces: async (input) =>
      host.call("outdatedWorkspaces", { path: input.path }, { hostId: input.hostId }),
    clearOutdatedWorkspaces: async (input) =>
      host.call(
        "clearOutdatedWorkspaces",
        { path: input.path, workspaces: input.workspaces },
        { hostId: input.hostId },
      ),
  });
}
