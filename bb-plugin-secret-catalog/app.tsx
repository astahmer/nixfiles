import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract, secretEntrySchema } from "./contract";
import type { z } from "zod";

type SecretEntry = z.infer<typeof secretEntrySchema>;
type SecretScope = "all" | "project" | "global" | "local";
type MutableScope = Exclude<SecretScope, "all">;
type HostOption = {
  id: string;
  name: string;
  status: "connected" | "disconnected";
  lifecycle: { phase: string };
};
type DirectoryResult = {
  directory: string;
  parent: string | null;
  entries: { kind: "directory" | "file"; name: string; path: string }[];
};
const entryId = (entry: SecretEntry) => `${entry.scope}:${entry.alias}:${entry.env}`;
const entryScope = (scope: string): MutableScope =>
  scope === "global" || scope === "local" ? scope : "project";

const styles = `
.secret-page{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--foreground);background:var(--background);font:13px/1.45 var(--font-sans,system-ui)}
.secret-toolbar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}.secret-brand{font-size:15px;font-weight:650;margin-right:auto}.secret-input,.secret-button{border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--foreground);padding:7px 10px}.secret-input{background:var(--background);min-width:90px}.secret-path{width:min(420px,48vw)}.secret-button{cursor:pointer}.secret-button:hover,.secret-row:hover{background:var(--accent)}.secret-button:disabled{opacity:.5;cursor:default}.secret-content{display:flex;min-height:0;flex:1}.secret-list{width:min(42%,420px);min-width:260px;overflow:auto;border-right:1px solid var(--border)}.secret-detail{min-width:0;flex:1;overflow:auto}.secret-search{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--border);padding:12px 14px;background:var(--background);color:var(--foreground);outline:none}.secret-row{display:flex;gap:9px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer}.secret-row[data-selected=true]{background:var(--accent)}.secret-row-main{min-width:0;flex:1}.secret-alias{font-weight:600;overflow-wrap:anywhere}.secret-meta,.secret-muted{color:var(--muted-foreground);font-size:11px}.secret-detail-title{padding:15px 16px;border-bottom:1px solid var(--border);font-weight:650}.secret-value{margin:14px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--card);font:12px/1.5 var(--font-mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.secret-actions{display:flex;gap:8px;padding:12px 14px;flex-wrap:wrap}.secret-empty{padding:28px 18px;text-align:center;color:var(--muted-foreground)}.secret-error{padding:10px 16px;color:var(--destructive);border-bottom:1px solid var(--border)}
.secret-editor{padding:16px;display:flex;flex-direction:column;gap:12px;max-width:600px}.secret-editor label{display:flex;flex-direction:column;gap:5px}.secret-editor input,.secret-editor select{border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);padding:8px}.secret-editor-note{color:var(--muted-foreground);font-size:11px}
.secret-host{max-width:240px}.secret-scope{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--border)}.secret-scope button{border:0;border-radius:5px;background:transparent;color:var(--muted-foreground);padding:6px 10px;cursor:pointer}.secret-scope button[data-active=true]{background:var(--accent);color:var(--foreground)}.secret-browser{position:absolute;z-index:4;inset:56px 16px auto auto;width:min(520px,90vw);max-height:70vh;overflow:auto;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card);box-shadow:0 8px 32px #0008}.secret-browser-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}.secret-browser-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}.secret-browser-entry{display:block;width:100%;padding:8px;border:0;border-radius:4px;background:transparent;color:var(--foreground);text-align:left;cursor:pointer}.secret-browser-entry:hover{background:var(--accent)}.secret-toolbar{position:relative}
@media(max-width:700px){.secret-content{flex-direction:column}.secret-list{width:100%;min-width:0;max-height:48%;border-right:0;border-bottom:1px solid var(--border)}.secret-path{width:60vw}}
`;

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [hostId, setHostId] = useState("");
  const [hosts, setHosts] = useState<HostOption[]>([]);
  const [cwd, setCwd] = useState("");
  const [activeScope, setActiveScope] = useState<SecretScope>("global");
  const [browser, setBrowser] = useState<DirectoryResult | null>(null);
  const [entries, setEntries] = useState<SecretEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("prod");
  const [value, setValue] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "update" | null>(null);
  const [draftAlias, setDraftAlias] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [draftType, setDraftType] = useState<"login" | "secure-note">("login");
  const [draftScope, setDraftScope] = useState<MutableScope>("project");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = entries.find((entry) => entryId(entry) === selectedId) ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      [entry.alias, entry.item, entry.envKey, entry.scope].some((field) =>
        field.toLocaleLowerCase().includes(query),
      ),
    );
  }, [entries, search]);

  const loadEntries = useCallback(
    async (selectedHostId: string, scope: SecretScope, projectPath: string) => {
      if (!selectedHostId || (scope === "project" && !projectPath.trim())) return;
      setBusy(true);
      setValue(null);
      try {
        const result = await rpc.call("list", {
          hostId: selectedHostId,
          cwd: projectPath.trim() || "/",
          scope,
        });
        setEntries(result.entries);
        setSelectedId((current) =>
          result.entries.some((entry) => entryId(entry) === current)
            ? current
            : result.entries[0]
              ? entryId(result.entries[0])
              : "",
        );
        setError(null);
        setMessage(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [rpc],
  );

  const refresh = useCallback(
    async (scope = activeScope) => {
      await loadEntries(hostId, scope, cwd);
    },
    [activeScope, cwd, hostId, loadEntries],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [config, availableHosts] = await Promise.all([sdk.system.config(), sdk.hosts.list()]);
        setHosts(availableHosts);
        const primary = availableHosts.find((host) => host.id === config.primaryHostId);
        const initialHost = primary ?? availableHosts.find((host) => host.status === "connected");
        if (!initialHost) {
          setError("No BB machines are configured.");
          return;
        }
        setHostId(initialHost.id);
        await loadEntries(initialHost.id, "global", "");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [sdk]);

  const reveal = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(
      "Secret value is visible in this BB window until you hide it or select another alias.",
    );
    try {
      const result = await rpc.call("get", {
        hostId,
        cwd: cwd.trim() || "/",
        alias: selected.alias,
        environment,
        scope: entryScope(selected.scope),
      });
      setValue(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("copy", {
        hostId,
        cwd: cwd.trim() || "/",
        alias: selected.alias,
        environment,
        scope: entryScope(selected.scope),
      });
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async () => {
    if (
      !hostId ||
      (draftScope !== "global" && !cwd.trim()) ||
      !draftAlias.trim() ||
      (editorMode === "create" && !draftValue) ||
      !editorMode
    )
      return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const selectedPath = cwd.trim() || "/";
      if (editorMode === "update" && selected && selected.alias !== draftAlias.trim()) {
        await rpc.call("rename", {
          hostId,
          cwd: selectedPath,
          alias: selected.alias,
          newAlias: draftAlias.trim(),
          scope: draftScope,
        });
      }
      let result = { message: `Renamed ${draftAlias.trim()}.` };
      if (draftValue) {
        result = await rpc.call("set", {
          hostId,
          cwd: selectedPath,
          alias: draftAlias.trim(),
          value: draftValue,
          environment,
          scope: draftScope,
          itemType: editorMode === "create" ? draftType : undefined,
        });
      }
      setDraftValue("");
      setEditorMode(null);
      await refresh(activeScope);
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeAlias = async () => {
    if (!selected || !window.confirm(`Remove the ${selected.scope} alias “${selected.alias}”?`))
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("unset", {
        hostId,
        cwd: cwd.trim() || "/",
        alias: selected.alias,
        scope: entryScope(selected.scope),
      });
      await refresh(activeScope);
      setSelectedId("");
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setDraftAlias("");
    setDraftValue("");
    setDraftType("login");
    setDraftScope(activeScope === "all" ? (cwd ? "project" : "global") : activeScope);
    setEditorMode("create");
    setValue(null);
    setMessage(null);
  };

  const browseDirectory = async (path?: string) => {
    if (!hostId) return;
    setError(null);
    try {
      const result = await sdk.hosts.directory({ hostId, ...(path ? { path } : {}) });
      setBrowser(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseProject = async () => {
    if (!hostId || !browser) return;
    setCwd(browser.directory);
    setBrowser(null);
    setActiveScope("all");
    await loadEntries(hostId, "all", browser.directory);
  };

  const openUpdate = () => {
    if (!selected) return;
    setDraftAlias(selected.alias);
    setDraftValue("");
    setDraftScope(entryScope(selected.scope));
    setEditorMode("update");
    setValue(null);
    setMessage(null);
  };

  const closeEditor = () => {
    setDraftValue("");
    setEditorMode(null);
  };

  return (
    <div className="secret-page">
      <style>{styles}</style>
      <header className="secret-toolbar">
        <strong className="secret-brand">Secret Catalog</strong>
        <select
          className="secret-input secret-host"
          aria-label="Machine"
          value={hostId}
          onChange={(event) => {
            const nextHostId = event.target.value;
            setHostId(nextHostId);
            setCwd("");
            setActiveScope("global");
            setBrowser(null);
            void loadEntries(nextHostId, "global", "");
          }}
        >
          {hosts.map((host) => (
            <option
              key={host.id}
              value={host.id}
              disabled={host.status !== "connected" || host.lifecycle.phase !== "active"}
            >
              {host.name} · {host.status}
            </option>
          ))}
        </select>
        <input
          className="secret-input secret-path"
          aria-label="Project directory on selected machine"
          placeholder="Choose a project folder…"
          value={cwd}
          onChange={(event) => setCwd(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setActiveScope("all");
              void loadEntries(hostId, "all", cwd);
            }
          }}
        />
        <button
          className="secret-button"
          disabled={busy || !hostId}
          onClick={() => void browseDirectory()}
        >
          Browse…
        </button>
        <button
          className="secret-button"
          disabled={busy || !hostId || (activeScope !== "global" && !cwd.trim())}
          onClick={openCreate}
        >
          New alias
        </button>
        {browser && (
          <div className="secret-browser" role="dialog" aria-label="Choose project folder">
            <div className="secret-browser-head">
              <button
                className="secret-button"
                disabled={!browser.parent}
                onClick={() => browser.parent && void browseDirectory(browser.parent)}
              >
                Up
              </button>
              <span className="secret-browser-path">{browser.directory}</span>
              <button className="secret-button" onClick={() => setBrowser(null)}>
                Close
              </button>
            </div>
            <button className="secret-button" onClick={() => void chooseProject()}>
              Use this folder
            </button>
            {browser.entries
              .filter((entry) => entry.kind === "directory")
              .map((entry) => (
                <button
                  className="secret-browser-entry"
                  key={entry.path}
                  onClick={() => void browseDirectory(entry.path)}
                >
                  📁 {entry.name}
                </button>
              ))}
            {browser.entries.length === 0 && <div className="secret-empty">No subfolders.</div>}
          </div>
        )}
      </header>
      {error && (
        <div className="secret-error" role="alert">
          {error}
        </div>
      )}
      <div className="secret-content">
        <aside className="secret-list" aria-label="Configured aliases">
          <nav className="secret-scope" aria-label="Secret scope">
            {(["all", "project", "global", "local"] as const).map((scope) => (
              <button
                key={scope}
                data-active={activeScope === scope}
                disabled={
                  (scope === "project" && !cwd.trim()) || (scope === "local" && !cwd.trim())
                }
                onClick={() => {
                  setActiveScope(scope);
                  void refresh(scope);
                }}
              >
                {scope[0]?.toLocaleUpperCase()}
                {scope.slice(1)}
              </button>
            ))}
          </nav>
          <input
            className="secret-search"
            aria-label="Search aliases"
            placeholder="Search aliases, items, or scope…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {filtered.map((entry) => (
            <div
              className="secret-row"
              key={entryId(entry)}
              data-selected={selectedId === entryId(entry)}
              onClick={() => {
                setSelectedId(entryId(entry));
                setEnvironment(entry.env);
                setValue(null);
                setMessage(null);
                closeEditor();
              }}
            >
              <span className="secret-row-main">
                <div className="secret-alias">{entry.alias}</div>
                <div className="secret-meta">
                  {entry.scope} · {entry.env} · {entry.item}
                </div>
              </span>
            </div>
          ))}
          {entries.length > 0 && filtered.length === 0 && (
            <div className="secret-empty">No aliases match.</div>
          )}
          {entries.length === 0 && (
            <div className="secret-empty">No {activeScope} aliases found.</div>
          )}
        </aside>
        <main className="secret-detail">
          {editorMode ? (
            <form
              className="secret-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void saveValue();
              }}
            >
              <h2>{editorMode === "create" ? "Add secret alias" : `Update ${draftAlias}`}</h2>
              {editorMode === "create" && (
                <label>
                  Scope
                  <select
                    value={draftScope}
                    onChange={(event) => setDraftScope(entryScope(event.target.value))}
                  >
                    <option value="project" disabled={!cwd.trim()}>
                      Project
                    </option>
                    <option value="global">Global</option>
                    <option value="local" disabled={!cwd.trim()}>
                      Local override
                    </option>
                  </select>
                </label>
              )}
              <label>
                Alias
                <input
                  aria-label="Secret alias"
                  value={draftAlias}
                  onChange={(event) => setDraftAlias(event.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              {editorMode === "create" && (
                <label>
                  Item type
                  <select
                    value={draftType}
                    onChange={(event) =>
                      setDraftType(event.target.value === "secure-note" ? "secure-note" : "login")
                    }
                  >
                    <option value="login">Login</option>
                    <option value="secure-note">Secure Note</option>
                  </select>
                </label>
              )}
              <label>
                Secret value
                <input
                  type="password"
                  aria-label="Secret value"
                  autoComplete="new-password"
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  required={editorMode === "create"}
                  placeholder={
                    editorMode === "update" ? "Leave blank to keep current value" : undefined
                  }
                />
              </label>
              <div className="secret-editor-note">
                BB sends this value to `secret` over stdin. The plugin does not store it.
              </div>
              <div className="secret-actions">
                <button
                  className="secret-button"
                  type="button"
                  disabled={busy}
                  onClick={closeEditor}
                >
                  Cancel
                </button>
                <button
                  className="secret-button"
                  type="submit"
                  disabled={busy || (!draftValue && editorMode === "create")}
                >
                  {busy ? "Saving…" : "Save through secret CLI"}
                </button>
              </div>
            </form>
          ) : selected ? (
            <>
              <div className="secret-detail-title">
                {selected.alias}
                <div className="secret-meta">
                  {selected.scope} · {selected.envKey} · {selected.field}
                </div>
              </div>
              <div className="secret-actions">
                <label className="secret-muted">
                  Environment{" "}
                  <input
                    className="secret-input"
                    value={environment}
                    onChange={(event) => {
                      setEnvironment(event.target.value);
                      setValue(null);
                    }}
                  />
                </label>
                <button
                  className="secret-button"
                  disabled={busy || !environment.trim()}
                  onClick={() => void copy()}
                >
                  Copy with secret CLI
                </button>
                <button
                  className="secret-button"
                  disabled={busy || !environment.trim()}
                  onClick={() => (value === null ? void reveal() : setValue(null))}
                >
                  {value === null ? "Reveal value" : "Hide value"}
                </button>
                <button className="secret-button" disabled={busy} onClick={openUpdate}>
                  Edit alias / value
                </button>
                <button
                  className="secret-button"
                  disabled={busy}
                  onClick={() => void removeAlias()}
                >
                  Remove alias
                </button>
              </div>
              {message && (
                <div className="secret-actions secret-muted" role="status">
                  {message}
                </div>
              )}
              {value !== null && <pre className="secret-value">{value || "(empty value)"}</pre>}
            </>
          ) : (
            <div className="secret-empty">Select an alias to inspect or copy its value.</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "secret-catalog",
    title: "Secret Catalog",
    icon: "KeyRound",
    path: "secrets",
    component: Page,
  });
});
