import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi): void {
  const restoring = new Set<string>();
  const recentArchiveEvents = new Map<
    string,
    { archivedAt: number; observedAt: number }
  >();
  const archiveEventTtlMs = 60_000;
  const archiveCascadeWindowMs = 1_000;

  bb.events.on("thread.archived", async ({ thread }) => {
    const archivedAt = thread.archivedAt;
    const parentThreadId = thread.parentThreadId;
    if (archivedAt === null) return;

    const observedAt = Date.now();
    for (const [threadId, event] of recentArchiveEvents) {
      if (observedAt - event.observedAt <= archiveEventTtlMs) break;
      recentArchiveEvents.delete(threadId);
    }
    recentArchiveEvents.set(thread.id, { archivedAt, observedAt });
    if (recentArchiveEvents.size > 2048) {
      const oldestThreadId = recentArchiveEvents.keys().next().value;
      if (oldestThreadId !== undefined) recentArchiveEvents.delete(oldestThreadId);
    }

    if (parentThreadId === null || restoring.has(thread.id)) return;

    restoring.add(thread.id);
    try {
      const [currentThread, parent] = await Promise.all([
        bb.sdk.threads.get({ threadId: thread.id }),
        bb.sdk.threads.get({ threadId: parentThreadId }),
      ]);
      const parentArchiveEvent = recentArchiveEvents.get(parentThreadId);
      const parentWasArchivedInCascade =
        parent.archivedAt !== null &&
        Math.abs(parent.archivedAt - archivedAt) <= archiveCascadeWindowMs;
      const parentArchiveEventWasInCascade =
        parentArchiveEvent !== undefined &&
        Math.abs(parentArchiveEvent.archivedAt - archivedAt) <=
          archiveCascadeWindowMs &&
        Math.abs(parentArchiveEvent.observedAt - observedAt) <=
          archiveCascadeWindowMs;

      if (
        currentThread.archivedAt === null ||
        currentThread.archivedAt !== archivedAt ||
        (!parentWasArchivedInCascade && !parentArchiveEventWasInCascade)
      ) {
        return;
      }

      await bb.sdk.threads.unarchive({ threadId: thread.id });
      bb.log.info(`Kept child thread ${thread.id} open after parent archive`);
    } catch (error) {
      bb.log.error(
        `Could not preserve child thread ${thread.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      restoring.delete(thread.id);
    }
  });
}
