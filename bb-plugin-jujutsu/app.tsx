import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

type Revision = {
  commitId: string;
  changeId: string;
  description: string;
  parents: string[];
  bookmarks: string[];
  tags: string[];
  workspaces: string[];
};
type Snapshot = {
  root: string;
  currentRevision: string;
  revisions: Revision[];
  changes: { path: string; status: string }[];
  workspaces: { name: string; path: string; revision: string }[];
  diff: string;
};

const styles = `
.jj-page{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--foreground);background:var(--background);font:13px/1.45 var(--font-sans,system-ui)}
.jj-toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.jj-brand{font-size:15px;font-weight:650;margin-right:8px}.jj-tabs{display:flex;gap:4px;margin-right:auto}.jj-tab,.jj-button{border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--foreground);padding:6px 10px;cursor:pointer}.jj-tab[aria-selected=true]{background:var(--accent);font-weight:600}.jj-button:hover,.jj-tab:hover{background:var(--accent)}
.jj-input{border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);padding:7px 9px;min-width:100px}.jj-path{width:min(360px,45vw)}.jj-host{width:145px}.jj-content{display:flex;min-height:0;flex:1}.jj-main{min-width:0;flex:1;overflow:auto}.jj-side{width:min(45%,620px);min-width:300px;border-left:1px solid var(--border);overflow:auto}.jj-error{padding:12px 16px;color:var(--destructive)}.jj-hint,.jj-muted{color:var(--muted-foreground)}.jj-hint{padding:10px 16px;border-bottom:1px solid var(--border)}
.jj-revision{display:flex;gap:12px;align-items:stretch;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer}.jj-revision:hover,.jj-revision[data-selected=true]{background:var(--accent)}.jj-revision[draggable=true]{cursor:grab}.jj-rail{width:18px;flex:none;position:relative;display:flex;justify-content:center}.jj-rail:before{content:"";position:absolute;top:-12px;bottom:-12px;width:2px;background:var(--border)}.jj-dot{z-index:1;width:11px;height:11px;border:2px solid var(--primary);border-radius:50%;background:var(--background);margin-top:5px}.jj-revbody{min-width:0;flex:1}.jj-revhead{display:flex;gap:7px;align-items:center}.jj-description{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.jj-id{font:11px var(--font-mono,monospace);color:var(--muted-foreground)}.jj-labels{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.jj-badge{font-size:10px;padding:1px 6px;border-radius:99px;background:var(--secondary);color:var(--secondary-foreground)}.jj-badge.bookmark{background:var(--primary);color:var(--primary-foreground)}.jj-badge.workspace{background:var(--accent);color:var(--accent-foreground)}
.jj-panel-title{font-weight:650;padding:12px 14px;border-bottom:1px solid var(--border)}.jj-diff{padding:12px 14px;overflow:auto;font:11px/1.5 var(--font-mono,monospace);white-space:pre;tab-size:2}.jj-changes{padding:4px 10px}.jj-file{display:flex;gap:8px;padding:6px;border-radius:5px;align-items:center}.jj-file:hover{background:var(--accent)}.jj-file input{margin:0}.jj-actions{display:flex;gap:7px;align-items:center;padding:10px 14px;flex-wrap:wrap}.jj-section{padding:10px 14px;border-bottom:1px solid var(--border)}.jj-section h3{font-size:12px;margin:0 0 8px}.jj-description-edit{width:100%;min-height:68px;resize:vertical}.jj-empty{padding:32px 18px;color:var(--muted-foreground);text-align:center}
@media(max-width:760px){.jj-content{flex-direction:column}.jj-side{width:100%;min-width:0;max-height:45%;border-left:0;border-top:1px solid var(--border)}.jj-path{width:60vw}}
`;

function label(revision: Revision) {
  return revision.description.trim().split("\n")[0] || "(no description)";
}

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [tab, setTab] = useState<"graph" | "source">("graph");
  const [path, setPath] = useState(() => localStorage.getItem("jj-plugin-path") ?? "");
  const [hostId, setHostId] = useState(() => localStorage.getItem("jj-plugin-host") ?? "");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [diff, setDiff] = useState("");
  const [revisionFiles, setRevisionFiles] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [splitMessage, setSplitMessage] = useState("");
  const [recentCount, setRecentCount] = useState(() => Number(localStorage.getItem("jj-plugin-recent") ?? 10));
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!path.trim() || !hostId.trim()) return;
    setBusy(true);
    try {
      const result = await rpc.call("inspect", { path: path.trim(), hostId: hostId.trim() });
      setSnapshot(result);
      setError(null);
      localStorage.setItem("jj-plugin-path", path.trim());
      localStorage.setItem("jj-plugin-host", hostId.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [hostId, path, rpc]);

  useEffect(() => {
    if (hostId) return;
    sdk.system.config().then((config) => {
      if (config.primaryHostId) setHostId(config.primaryHostId);
    }).catch(() => undefined);
  }, [hostId, sdk]);
  useEffect(() => { if (path && hostId) void refresh(); }, []);

  const revisions = snapshot?.revisions ?? [];
  const recentRevisions = useMemo(() => {
    if (!snapshot) return [];
    const revisionsById = new Map(revisions.map((revision) => [revision.commitId, revision]));
    const recent: Revision[] = [];
    let current = snapshot.currentRevision;
    while (recent.length < Math.max(1, recentCount)) {
      const revision = revisionsById.get(current);
      if (!revision) break;
      recent.push(revision);
      current = revision.parents[0] ?? "";
    }
    return recent;
  }, [recentCount, revisions, snapshot]);
  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); await refresh(); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const selectRevision = async (revision: Revision) => {
    setSelected(revision);
    setDescription(revision.description);
    setSplitMessage(`Split from: ${label(revision)}`);
    try {
      const result = await rpc.call("diff", { path, hostId, revision: revision.commitId });
      setDiff(result.diff);
      setRevisionFiles(result.files);
      setSelectedFiles([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const saveDescription = () => selected && runAction(() => rpc.call("describe", { path, hostId, revision: selected.commitId, description }));
  const dropOnRevision = (destination: Revision, event: React.DragEvent) => {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/jj-revision");
    if (source && source !== destination.commitId) {
      void runAction(() => rpc.call("rebase", { path, hostId, revision: source, destination: destination.commitId }));
    }
  };

  return <div className="jj-page">
    <style>{styles}</style>
    <header className="jj-toolbar">
      <strong className="jj-brand">Jujutsu</strong>
      <nav className="jj-tabs" aria-label="Jujutsu views">
        <button className="jj-tab" aria-selected={tab === "graph"} onClick={() => setTab("graph")}>Revision graph</button>
        <button className="jj-tab" aria-selected={tab === "source"} onClick={() => setTab("source")}>Source Control</button>
      </nav>
      <input className="jj-input jj-host" aria-label="BB host ID" placeholder="Host ID" value={hostId} onChange={(event) => setHostId(event.target.value)} />
      <input className="jj-input jj-path" aria-label="Jujutsu repository path" placeholder="Repository path on host" value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void refresh(); }} />
      <button className="jj-button" disabled={busy || !path || !hostId} onClick={() => void refresh()}>{busy ? "Loading…" : "Refresh"}</button>
    </header>
    {error && <div role="alert" className="jj-error">{error}</div>}
    {!snapshot ? <div className="jj-empty">Enter a repository path on the selected BB host to load its Jujutsu history.</div> : <>
      <div className="jj-hint">{snapshot.root} <span className="jj-muted">· drag a revision onto another to rebase</span></div>
      {tab === "graph" ? <div className="jj-content">
        <main className="jj-main" aria-label="Revision graph">
          {revisions.map((revision) => <div key={revision.commitId} className="jj-revision" draggable onDragStart={(event) => event.dataTransfer.setData("text/jj-revision", revision.commitId)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnRevision(revision, event)} onClick={() => void selectRevision(revision)} data-selected={selected?.commitId === revision.commitId}>
            <span className="jj-rail"><i className="jj-dot" /></span>
            <div className="jj-revbody"><div className="jj-revhead"><span className="jj-description">{label(revision)}</span><code className="jj-id">{revision.changeId}</code></div><div className="jj-labels">
              {revision.bookmarks.map((bookmark) => <span className="jj-badge bookmark" key={bookmark}>{bookmark}</span>)}
              {revision.tags.map((tag) => <span className="jj-badge" key={tag}>tag: {tag}</span>)}
              {revision.workspaces.map((workspace) => <span className="jj-badge workspace" key={workspace}>⌂ {workspace}</span>)}
              {revision.parents.map((parent) => <span className="jj-id" key={parent}>← {parent}</span>)}
            </div></div>
          </div>)}
        </main>
        <aside className="jj-side">
          <div className="jj-panel-title">{selected ? `Revision ${selected.changeId}` : "Revision details"}</div>
          {!selected ? <div className="jj-empty">Select revision to inspect changed files.</div> : <>
            <section className="jj-section"><h3>Description</h3><textarea className="jj-input jj-description-edit" value={description} onChange={(event) => setDescription(event.target.value)} /><div className="jj-actions"><button className="jj-button" disabled={busy} onClick={() => void saveDescription()}>Save description</button><button className="jj-button" disabled={busy} onClick={() => void runAction(() => rpc.call("squash", { path, hostId, revision: selected.commitId, destination: selected.parents[0] ?? "@-" }))}>Squash into parent</button></div></section>
            <pre className="jj-diff">{diff || "No diff for this revision."}</pre>
          </>}
        </aside>
      </div> : <div className="jj-content">
        <main className="jj-main">
          <section className="jj-section"><h3>Working Copy</h3><div className="jj-muted">{snapshot.changes.length} changed files</div><div className="jj-changes">
            {snapshot.changes.length === 0 ? <div className="jj-muted">Working copy clean</div> : snapshot.changes.map((change) => <label className="jj-file" key={change.path}><input type="checkbox" checked={selectedFiles.includes(change.path)} onChange={(event) => setSelectedFiles(event.target.checked ? [...selectedFiles, change.path] : selectedFiles.filter((file) => file !== change.path))} /><code>{change.status}</code><span>{change.path}</span></label>)}
          </div><pre className="jj-diff">{snapshot.diff || "No working-copy diff."}</pre></section>
          <section className="jj-section"><div className="jj-actions" style={{ padding: 0 }}><h3 style={{ margin: 0, marginRight: "auto" }}>Recent revisions</h3><label className="jj-muted">Show <input className="jj-input" type="number" min={1} max={80} value={recentCount} onChange={(event) => { const next = Math.max(1, Math.min(80, Number(event.target.value))); setRecentCount(next); localStorage.setItem("jj-plugin-recent", String(next)); }} style={{ width: 68, padding: "4px 7px" }} /> revisions</label></div>
            {recentRevisions.map((revision, index) => <div className="jj-revision" key={revision.commitId} onClick={() => void selectRevision(revision)} data-selected={selected?.commitId === revision.commitId}><span className="jj-rail"><i className="jj-dot" /></span><div className="jj-revbody"><div className="jj-revhead"><span className="jj-id">@{index === 0 ? "" : `-${index}`}</span><span className="jj-description">{label(revision)}</span><code className="jj-id">{revision.changeId}</code></div></div></div>)}
          </section>
        </main>
        <aside className="jj-side"><div className="jj-panel-title">Split selected revision</div>
          {!selected ? <div className="jj-empty">Choose a revision from Recent revisions, then split selected files into a new child revision.</div> : <><p className="jj-hint">Selected {selected.changeId}. Pick files to keep together in the new revision.</p><div className="jj-changes">{revisionFiles.length === 0 ? <p className="jj-muted">This revision has no file changes to split.</p> : revisionFiles.map((file) => <label className="jj-file" key={file}><input type="checkbox" checked={selectedFiles.includes(file)} onChange={(event) => setSelectedFiles(event.target.checked ? [...selectedFiles, file] : selectedFiles.filter((candidate) => candidate !== file))} /><span>{file}</span></label>)}</div><div className="jj-actions"><input className="jj-input" aria-label="New revision description" value={splitMessage} onChange={(event) => setSplitMessage(event.target.value)} /><button className="jj-button" disabled={busy || selectedFiles.length === 0} onClick={() => void runAction(() => rpc.call("split", { path, hostId, revision: selected.commitId, files: selectedFiles, message: splitMessage }))}>Split selected files</button><button className="jj-button" disabled={busy} onClick={() => void runAction(() => rpc.call("squash", { path, hostId, revision: selected.commitId, destination: selected.parents[0] ?? "@-" }))}>Squash into parent</button></div></>}
          <div className="jj-panel-title">Workspaces</div>{snapshot.workspaces.map((workspace) => <div className="jj-file" key={workspace.name}><span className="jj-badge workspace">⌂ {workspace.name}</span><code>{workspace.revision}</code><span className="jj-muted">{workspace.path}</span></div>)}
        </aside>
      </div>}
    </>}
  </div>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "jj-workbench", title: "Jujutsu", icon: "GitBranch", path: "jj", component: Page });
});
