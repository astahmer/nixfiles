import type { BbPluginApi } from "@get-bb/plugin-sdk";

const HANDOFF_PREFIX = "Continue from ";

export default function plugin(bb: BbPluginApi): void {
  async function attachHandoffParent(threadId: string): Promise<void> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.parentThreadId !== null) return;

    const events = await bb.sdk.threads.events.list({
      threadId,
      order: "asc",
      limit: "1",
      types: ["client/turn/requested"],
    });
    const start = events[0];
    if (start?.type !== "client/turn/requested") return;

    const request = start.data;
    if (
      request.source !== "spawn" ||
      request.initiator !== "user" ||
      request.target.kind !== "thread-start"
    ) {
      return;
    }

    const firstText = request.input.find((block) => block.type === "text");
    if (firstText?.type !== "text" || !firstText.text.startsWith(HANDOFF_PREFIX)) {
      return;
    }

    const threadMention = firstText.mentions.find(
      (mention) =>
        mention.start === HANDOFF_PREFIX.length &&
        mention.resource.kind === "thread",
    );
    const rawMention = /^Continue from @thread:(thr_[a-z0-9_-]+)(?:\s|$)/u.exec(
      firstText.text,
    );
    const parentThreadId =
      threadMention?.resource.kind === "thread"
        ? threadMention.resource.threadId
        : rawMention?.[1];
    if (parentThreadId === undefined) return;

    const parent = await bb.sdk.threads.get({ threadId: parentThreadId });
    if (parent.id === thread.id || parent.projectId !== thread.projectId) return;

    // Re-read before updating so a manual parent choice made after thread start wins.
    const current = await bb.sdk.threads.get({ threadId });
    if (current.parentThreadId !== null) return;

    await bb.sdk.threads.update({
      threadId,
      parentThreadId: parent.id,
    });
    bb.log.info(`Linked handoff thread ${threadId} to ${parent.id}`);
  }

  bb.events.on("thread.active", ({ thread }) =>
    attachHandoffParent(thread.id),
  );
  bb.events.on("thread.failed", ({ thread }) =>
    attachHandoffParent(thread.id),
  );
}
