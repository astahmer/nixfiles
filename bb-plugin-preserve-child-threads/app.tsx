import {
  definePluginApp,
  useBbContext,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";

type Thread = Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["list"]>>[number];

const threadLabel = (thread: Thread) =>
  `${thread.title ?? thread.titleFallback ?? "Untitled thread"} · ${thread.projectId.slice(-6)}`;

const isDescendant = (threads: readonly Thread[], threadId: string, ancestorId: string) => {
  const parents = new Map(threads.map((thread) => [thread.id, thread.parentThreadId]));
  let currentId = threadId;
  const visited = new Set<string>();

  while (currentId !== "" && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = parents.get(currentId) ?? "";
  }

  return false;
};

const LinkExistingThread = () => {
  const sdk = useSdk();
  const context = useBbContext();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [childId, setChildId] = useState("");
  const [parentId, setParentId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void sdk.threads
      .list({
        ...(context.projectId === null ? {} : { projectId: context.projectId }),
        includeHidden: false,
        limit: 200,
        signal: controller.signal,
      })
      .then((result) => setThreads(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not load threads.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [context.projectId, sdk]);

  const child = threads.find((thread) => thread.id === childId);
  const parent = threads.find((thread) => thread.id === parentId);
  const orderedThreads = useMemo(
    () => [...threads].sort((left, right) => threadLabel(left).localeCompare(threadLabel(right))),
    [threads],
  );
  const invalidLink =
    child === undefined ||
    parent === undefined ||
    child.id === parent.id ||
    child.projectId !== parent.projectId ||
    isDescendant(threads, parent.id, child.id);

  const linkThread = async () => {
    if (invalidLink || child === undefined || parent === undefined) return;

    setError(null);
    setNotice(null);
    setIsSaving(true);

    try {
      await sdk.threads.update({
        threadId: child.id,
        parentThreadId: parent.id,
      });
      setThreads((current) =>
        current.map((thread) =>
          thread.id === child.id ? { ...thread, parentThreadId: parent.id } : thread,
        ),
      );
      setNotice(`Linked “${threadLabel(child)}” under “${threadLabel(parent)}”.`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not link these threads.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      aria-label="Link existing thread"
      style={{
        background: "var(--background, #1f1f1f)",
        border: "1px solid var(--border, #444)",
        borderRadius: 10,
        bottom: 56,
        color: "var(--foreground, #eee)",
        display: "grid",
        fontSize: 13,
        gap: 6,
        lineHeight: 1.25,
        left: 12,
        maxHeight: "min(70vh, 560px)",
        overflow: "auto",
        padding: 12,
        position: "fixed",
        width: "min(360px, calc(100vw - 24px))",
        zIndex: 1000,
      }}
    >
      <header><strong>Link existing thread</strong></header>
      <p style={{ margin: 0 }}>BB links only. No AI turn.</p>
      <button
        disabled={invalidLink || isLoading || isSaving}
        onClick={() => void linkThread()}
        style={{ justifySelf: "start", margin: 0, padding: "4px 8px" }}
        type="button"
      >
        {isSaving ? "Linking…" : "Link threads"}
      </button>
      {isLoading ? <p>Loading threads…</p> : null}
      {threads.length === 0 && !isLoading && error === null ? <p>No threads found.</p> : null}
      <label style={{ display: "grid", gap: 2 }}>
        Child thread
        <select onChange={(event) => setChildId(event.currentTarget.value)} value={childId}>
          <option value="">Choose a thread</option>
          {orderedThreads.map((thread) => (
            <option key={thread.id} value={thread.id}>{threadLabel(thread)}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 2 }}>
        Parent thread
        <select onChange={(event) => setParentId(event.currentTarget.value)} value={parentId}>
          <option value="">Choose a parent</option>
          {orderedThreads.map((thread) => (
            <option key={thread.id} value={thread.id}>{threadLabel(thread)}</option>
          ))}
        </select>
      </label>
      {child !== undefined && parent !== undefined && child.projectId !== parent.projectId ? (
        <p>Choose threads from the same project.</p>
      ) : null}
      {child !== undefined && parent !== undefined && isDescendant(threads, parent.id, child.id) ? (
        <p>This link would create a parent-child cycle.</p>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
      {notice === null ? null : <p role="status">{notice}</p>}
    </section>
  );
};

export default definePluginApp((app) => {
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "link-existing-thread",
    label: "Link existing thread",
    icon: "GitFork",
    component: LinkExistingThread,
  });
});
