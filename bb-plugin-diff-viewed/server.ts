// bb-plugin-diff-viewed — backend entry.
//
// One job: persist which files in a thread's diff have been marked viewed, so
// the mark survives a reload and follows the thread across app windows. All
// the interesting logic — keying, fingerprinting, pruning — lives in
// viewed/marks.ts as pure functions; this file is the storage boundary and the
// wire contract.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { prune, recordKey, withMark, type ViewedRecord } from "./viewed/marks";

const recordSchema = z.record(z.string(), z.string());

const threadIdSchema = z.string().trim().min(1).max(200);
// A rename card's label is `previous -> current`, so paths are not bounded by
// a single path length. 2000 is generous and still keeps a hostile client from
// filling kv storage with one key.
const pathSchema = z.string().trim().min(1).max(2000);

export const rpcContract = defineRpcContract({
  viewed_list: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ record: recordSchema }),
  },
  viewed_set: {
    input: z
      .object({
        threadId: threadIdSchema,
        path: pathSchema,
        fingerprint: z.string().trim().min(1).max(200),
        viewed: z.boolean(),
      })
      .strict(),
    output: z.object({ record: recordSchema }),
  },
  viewed_prune: {
    input: z
      .object({
        threadId: threadIdSchema,
        presentPaths: z.array(pathSchema).max(5000),
      })
      .strict(),
    output: z.object({ record: recordSchema }),
  },
  filter_get: {
    input: z.null(),
    output: z.object({
      onlyUnviewed: z.boolean(),
      autoMarkOnScroll: z.boolean(),
    }),
  },
  filter_set: {
    input: z.object({ onlyUnviewed: z.boolean() }).strict(),
    output: z.object({ onlyUnviewed: z.boolean() }),
  },
  problem_report: {
    input: z.object({ message: z.string().trim().min(1).max(1000) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
});

/**
 * Whether the changes panel hides files marked viewed. One setting for every
 * thread, since it describes how you like to read a diff rather than anything
 * about one diff.
 */
const FILTER_KEY = "filter:only-unviewed";

/**
 * Realtime channel the content script listens on. The payload carries the
 * thread id so a window showing a different thread can ignore it without a
 * refetch.
 */
export const VIEWED_CHANGED = "viewed-changed";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    autoMarkOnScroll: {
      type: "boolean",
      label: "Mark files viewed when scrolling past them",
      description:
        "Automatically check Viewed and collapse a file when its header scrolls above the changes panel.",
      default: false,
    },
  });

  async function read(threadId: string): Promise<ViewedRecord> {
    return (await bb.storage.kv.get<ViewedRecord>(recordKey(threadId))) ?? {};
  }

  /**
   * Persist only when the pure layer actually produced a different record.
   * Identity is the signal: `withMark` and `prune` return their input when
   * nothing changed, which keeps a redundant checkbox click from writing
   * storage and waking every open window.
   */
  async function commit(
    threadId: string,
    before: ViewedRecord,
    after: ViewedRecord,
  ): Promise<ViewedRecord> {
    if (after === before) return before;
    await bb.storage.kv.set(recordKey(threadId), after);
    bb.realtime.publish(VIEWED_CHANGED, { threadId });
    return after;
  }

  bb.rpc.register(rpcContract, {
    viewed_list: async ({ threadId }) => ({ record: await read(threadId) }),
    viewed_set: async ({ threadId, path, fingerprint, viewed }) => {
      const before = await read(threadId);
      const after = withMark(before, { path, fingerprint }, viewed);
      return { record: await commit(threadId, before, after) };
    },
    viewed_prune: async ({ threadId, presentPaths }) => {
      const before = await read(threadId);
      const after = prune(before, presentPaths);
      return { record: await commit(threadId, before, after) };
    },
    filter_get: async () => ({
      onlyUnviewed: (await bb.storage.kv.get<boolean>(FILTER_KEY)) === true,
      autoMarkOnScroll: (await settings.get()).autoMarkOnScroll,
    }),
    filter_set: async ({ onlyUnviewed }) => {
      await bb.storage.kv.set(FILTER_KEY, onlyUnviewed);
      return { onlyUnviewed };
    },
    // The content script calls this when it cannot read bb's DOM the way it
    // expects, so a bb update that breaks the plugin shows up in
    // `bb plugin logs diff-viewed` and not only in a devtools console.
    problem_report: async ({ message }) => {
      bb.log.warn(message);
      return { ok: true as const };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
