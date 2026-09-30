import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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
type KnownProjectPath = { name: string; path: string; hostId: string };
const entryId = (entry: SecretEntry) => `${entry.scope}:${entry.alias}:${entry.env}`;
const entryScope = (scope: string): MutableScope =>
  scope === "global" || scope === "local" ? scope : "project";

const styles = `
.secret-page{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--foreground);background:var(--background);font:13px/1.45 var(--font-sans,system-ui)}
.secret-toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)}.secret-brand{font-size:15px;font-weight:650;white-space:nowrap;margin-right:8px}.secret-input,.secret-button{border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--foreground);padding:7px 10px;font:inherit}.secret-input{background:var(--background);min-width:90px}.secret-host{width:min(260px,28vw);flex:0 1 auto}.secret-project-picker{display:flex;min-width:0;flex:1}.secret-project-picker .secret-path{width:100%;border-radius:6px 0 0 6px}.secret-project-picker .secret-button{border-radius:0 6px 6px 0}.secret-button{cursor:pointer;white-space:nowrap}.secret-button:hover,.secret-row:hover{background:var(--accent)}.secret-button:disabled{opacity:.5;cursor:default}.secret-content{display:flex;min-height:0;flex:1}.secret-list{width:min(38%,390px);min-width:260px;overflow:auto;border-right:1px solid var(--border)}.secret-detail{min-width:0;flex:1;overflow:auto}.secret-search{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--border);padding:9px 12px;background:var(--background);color:var(--foreground);outline:none}.secret-row{width:100%;display:flex;gap:8px;align-items:center;padding:6px 12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-row[data-selected=true]{background:var(--accent)}.secret-row:focus-visible,.secret-search:focus-visible,.secret-input:focus-visible,.secret-button:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}.secret-row-main{min-width:0;flex:1}.secret-alias{font-weight:600;line-height:1.25;overflow-wrap:anywhere}.secret-meta,.secret-muted{color:var(--muted-foreground);font-size:11px}.secret-row .secret-meta{line-height:1.25}.secret-detail-title{padding:14px 16px;border-bottom:1px solid var(--border);font-weight:650}.secret-detail-toolbar{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}.secret-environment{display:flex;align-items:center;gap:8px;color:var(--muted-foreground);font-size:11px}.secret-environment .secret-input{width:130px}.secret-primary-actions,.secret-manage-actions{display:flex;gap:6px;align-items:center}.secret-manage{position:relative}.secret-manage summary{padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;list-style:none}.secret-manage summary::-webkit-details-marker{display:none}.secret-manage-actions{padding-top:7px}.secret-value{margin:14px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--card);font:12px/1.5 var(--font-mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.secret-actions{display:flex;gap:8px;padding:12px 14px;flex-wrap:wrap}.secret-empty{padding:22px 16px;text-align:center;color:var(--muted-foreground)}.secret-error{padding:10px 16px;color:var(--destructive);border-bottom:1px solid var(--border)}
.secret-editor{padding:16px;display:flex;flex-direction:column;gap:12px;max-width:600px}.secret-editor label{display:flex;flex-direction:column;gap:5px}.secret-editor input,.secret-editor select{border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);padding:8px}.secret-editor-note{color:var(--muted-foreground);font-size:11px}
.secret-list-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border)}.secret-scope{display:flex;min-width:0;gap:2px}.secret-scope button{border:0;border-radius:5px;background:transparent;color:var(--muted-foreground);padding:6px 8px;cursor:pointer;font:inherit;font-size:12px}.secret-scope button[data-active=true]{background:var(--accent);color:var(--foreground)}.secret-list-head .secret-button{padding:6px 9px}.secret-picker-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:rgb(0 0 0/.58)}.secret-picker{display:flex;flex-direction:column;width:min(720px,92vw);max-height:min(760px,84vh);padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--card);color:var(--foreground);box-shadow:0 18px 60px #000a}.secret-picker-header{display:flex;align-items:center;gap:8px}.secret-picker-path{min-width:0;flex:1}.secret-picker-path input{width:100%;box-sizing:border-box;border:0;background:transparent;color:var(--foreground);font:14px/1.4 var(--font-mono,monospace);outline:none}.secret-picker-section{padding:12px 4px 6px;color:var(--muted-foreground);font-size:11px}.secret-picker-list{min-height:120px;overflow:auto}.secret-picker-entry{display:flex;width:100%;align-items:center;gap:10px;padding:7px 9px;border:0;border-radius:6px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-picker-entry[data-active=true],.secret-picker-entry:hover{background:var(--accent)}.secret-picker-entry:focus-visible{outline:2px solid var(--ring,var(--primary))}.secret-picker-entry-icon{width:18px;color:var(--muted-foreground)}.secret-picker-footer{display:flex;justify-content:center;gap:14px;padding:10px 4px 2px;border-top:1px solid var(--border);color:var(--muted-foreground);font-size:11px}.secret-picker-footer kbd{padding:2px 5px;border:1px solid var(--border);border-radius:4px;color:var(--foreground)}
.secret-confirm-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgb(0 0 0/.62)}.secret-confirm{width:min(440px,100%);padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--foreground);box-shadow:0 16px 48px #000a}.secret-confirm h2{margin:0 0 8px;font-size:16px}.secret-confirm p{margin:0 0 16px;color:var(--muted-foreground)}.secret-button-danger{border-color:var(--destructive);background:var(--destructive);color:var(--destructive-foreground,#fff)}.secret-button-danger:hover{filter:brightness(1.08)}
.secret-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.secret-scope button:disabled{opacity:.45;cursor:default}.secret-picker-header .secret-button{display:flex;align-items:center;gap:4px}.secret-picker-header .secret-button kbd{margin-left:5px;color:var(--muted-foreground);font-size:10px}.secret-picker-entry-icon{position:relative;display:flex;align-items:center}.secret-picker-entry-icon:before{content:"";display:block;width:13px;height:9px;border:1.5px solid currentColor;border-radius:2px}.secret-picker-entry-icon:after{content:"";position:absolute;top:1px;left:2px;width:5px;height:2px;border:1.5px solid currentColor;border-bottom:0;border-radius:2px 2px 0 0}.secret-toolbar .secret-project-picker .secret-path{border-radius:6px;cursor:pointer}.secret-project-picker .secret-path:hover{border-color:var(--ring,var(--primary))}.secret-picker{width:min(1000px,86vw);max-height:min(780px,84vh);padding:16px 10px 0;overflow:hidden}.secret-picker-header{padding:0 10px 12px;border-bottom:1px solid var(--border)}.secret-picker-header .secret-button{flex:none}.secret-picker-path input{height:44px;padding:0 8px;font:16px/1.4 var(--font-sans,system-ui)}.secret-picker-section{padding:16px 16px 8px;font-size:12px}.secret-picker-list{max-height:min(620px,65vh);min-height:160px;padding:0 7px 8px;overflow:auto}.secret-project-option{display:flex;width:100%;min-height:70px;align-items:center;gap:12px;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-project-option[data-active=true],.secret-project-option:hover{background:var(--accent)}.secret-project-option:focus-visible{outline:2px solid var(--ring,var(--primary))}.secret-project-option kbd{margin-left:auto;color:var(--muted-foreground)}.secret-project-mark{display:grid;width:28px;height:28px;flex:none;place-items:center;border-radius:7px;background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary);font-size:10px;font-weight:700}.secret-project-option:nth-child(6n + 2) .secret-project-mark{background:#ff910022;color:#ff9100}.secret-project-option:nth-child(6n + 3) .secret-project-mark{background:#00bcd422;color:#00bcd4}.secret-project-option:nth-child(6n + 4) .secret-project-mark{background:#8b5cf622;color:#a78bfa}.secret-project-option:nth-child(6n + 5) .secret-project-mark{background:#10b98122;color:#10b981}.secret-project-option-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;font-size:15px}.secret-project-option-copy small{overflow:hidden;color:var(--muted-foreground);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.secret-picker-footer{justify-content:flex-start;gap:18px;padding:12px 16px;background:var(--background)}.secret-picker-error{padding:10px 16px;color:var(--destructive)}
@media(max-width:700px){.secret-toolbar{flex-wrap:wrap}.secret-brand{width:100%}.secret-host{width:40%}.secret-project-picker{flex:1}.secret-content{flex-direction:column}.secret-list{width:100%;min-width:0;max-height:48%;border-right:0;border-bottom:1px solid var(--border)}.secret-path{width:60vw}.secret-list-head{flex-wrap:wrap}}
.secret-picker{width:min(620px,calc(100vw - 32px));max-height:min(520px,78vh);padding:8px 7px 0;border-radius:12px}.secret-picker-header{padding:0 7px 6px;gap:5px}.secret-picker-path input{height:36px;font-size:14px}.secret-picker-section{padding:8px 10px 4px;font-size:11px}.secret-picker-list{max-height:min(390px,60vh);min-height:0;padding:0 4px 5px}.secret-project-option{min-height:42px;gap:8px;padding:5px 7px;border-radius:6px}.secret-project-mark{width:20px;height:20px;border-radius:5px;font-size:9px}.secret-project-option-copy{gap:0;font-size:13px}.secret-project-option-copy small{font-size:10px}.secret-picker-entry{min-height:32px;padding:4px 8px}.secret-picker-footer{gap:10px;padding:7px 9px;font-size:10px}.secret-picker-footer kbd{padding:1px 4px}
`;

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const [hostId, setHostId] = useState("");
  const [hosts, setHosts] = useState<HostOption[]>([]);
  const [projectPaths, setProjectPaths] = useState<KnownProjectPath[]>([]);
  const [cwd, setCwd] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectIndex, setProjectIndex] = useState(0);
  const [activeScope, setActiveScope] = useState<SecretScope>("global");
  const [browser, setBrowser] = useState<DirectoryResult | null>(null);
  const [browserIndex, setBrowserIndex] = useState(0);
  const directoryRequest = useRef(0);
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
  const [removeConfirmation, setRemoveConfirmation] = useState(false);
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
  const selectedFilteredIndex = filtered.findIndex((entry) => entryId(entry) === selectedId);
  const directories = browser?.entries.filter((entry) => entry.kind === "directory") ?? [];
  const availableProjectPaths = useMemo(
    () => projectPaths.filter((project) => project.hostId === hostId),
    [hostId, projectPaths],
  );
  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLocaleLowerCase();
    return availableProjectPaths.filter(
      (project) => !query || `${project.name} ${project.path}`.toLocaleLowerCase().includes(query),
    );
  }, [availableProjectPaths, projectQuery]);
  const isDirectoryQuery = projectQuery.startsWith("/");

  const selectEntry = (entry: SecretEntry) => {
    setSelectedId(entryId(entry));
    setEnvironment(entry.env);
    setValue(null);
    setMessage(null);
    closeEditor();
  };

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
        const [config, availableHosts, projects] = await Promise.all([
          sdk.system.config(),
          sdk.hosts.list(),
          sdk.projects.list({ includePersonal: true }),
        ]);
        setHosts(availableHosts);
        setProjectPaths(
          projects.flatMap((project) =>
            project.sources.map((source) => ({
              name: project.name,
              path: source.path,
              hostId: source.hostId,
            })),
          ),
        );
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
    if (!selected) return;
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
      setRemoveConfirmation(false);
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
    const requestId = ++directoryRequest.current;
    setError(null);
    try {
      const result = await sdk.hosts.directory({ hostId, ...(path ? { path } : {}) });
      if (requestId !== directoryRequest.current) return;
      setBrowser(result);
      setProjectQuery(result.directory);
      setBrowserIndex(0);
    } catch (cause) {
      if (requestId !== directoryRequest.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const chooseProject = async () => {
    if (!hostId || !projectQuery.trim()) return;
    directoryRequest.current += 1;
    const selectedPath = projectQuery.trim();
    setCwd(selectedPath);
    setBrowser(null);
    setProjectPickerOpen(false);
    setActiveScope("all");
    await loadEntries(hostId, "all", selectedPath);
  };

  const chooseKnownProject = async (project: KnownProjectPath) => {
    directoryRequest.current += 1;
    setProjectQuery("");
    setProjectPickerOpen(false);
    setHostId(project.hostId);
    setCwd(project.path);
    setActiveScope("all");
    await loadEntries(project.hostId, "all", project.path);
  };

  const openProjectPicker = () => {
    directoryRequest.current += 1;
    setProjectQuery("");
    setProjectIndex(0);
    setBrowser(null);
    setProjectPickerOpen(true);
  };

  const handleBrowserKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isDirectoryQuery && event.metaKey && /^[1-9]$/.test(event.key)) {
      const project = filteredProjects[Number(event.key) - 1];
      if (project) void chooseKnownProject(project);
      return;
    }
    if (!isDirectoryQuery && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setProjectIndex((current) =>
        event.key === "ArrowDown"
          ? Math.max(0, Math.min(current + 1, filteredProjects.length - 1))
          : Math.max(current - 1, 0),
      );
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (directories.length > 0) {
        setBrowserIndex((current) =>
          event.key === "ArrowDown"
            ? Math.min(current + 1, directories.length - 1)
            : Math.max(current - 1, 0),
        );
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        void chooseProject();
        return;
      }
      if (!isDirectoryQuery) {
        const project = filteredProjects[projectIndex];
        if (project) void chooseKnownProject(project);
        return;
      }
      const directory = directories[browserIndex];
      if (directory) void browseDirectory(directory.path);
      else if (projectQuery.trim()) void browseDirectory(projectQuery.trim());
      return;
    }
    if (
      isDirectoryQuery &&
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === 0 &&
      browser?.parent
    ) {
      event.preventDefault();
      setProjectQuery(browser.parent);
    }
    if (event.key === "Escape") {
      directoryRequest.current += 1;
      setProjectPickerOpen(false);
      setBrowser(null);
    }
  };

  useEffect(() => {
    if (projectPickerOpen && isDirectoryQuery) {
      const timeout = window.setTimeout(() => void browseDirectory(projectQuery), 250);
      return () => window.clearTimeout(timeout);
    }
  }, [projectPickerOpen, isDirectoryQuery, projectQuery, hostId]);

  useEffect(() => {
    document
      .getElementById(
        `${isDirectoryQuery ? "secret-picker-entry" : "secret-project-option"}-${isDirectoryQuery ? browserIndex : projectIndex}`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [browserIndex, browser, isDirectoryQuery, projectIndex]);

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
        <div className="secret-project-picker">
          <input
            className="secret-input secret-path"
            aria-label="Project directory on selected machine"
            placeholder="Choose a project folder…"
            value={cwd}
            readOnly
            aria-haspopup="dialog"
            onClick={openProjectPicker}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") openProjectPicker();
            }}
          />
        </div>
      </header>
      {projectPickerOpen && (
        <div
          className="secret-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              directoryRequest.current += 1;
              setProjectPickerOpen(false);
            }
          }}
        >
          <section
            className="secret-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="secret-picker-title"
          >
            <h2 id="secret-picker-title" className="secret-sr-only">
              Choose project
            </h2>
            <div className="secret-picker-header">
              {isDirectoryQuery && (
                <button
                  className="secret-button"
                  aria-label="Back to projects"
                  onClick={() => {
                    setProjectQuery("");
                    setBrowser(null);
                  }}
                >
                  ←
                </button>
              )}
              <div className="secret-picker-path">
                <input
                  autoFocus
                  aria-label="Search projects or enter a folder path"
                  placeholder="Search projects or type / for a folder…"
                  value={projectQuery}
                  onChange={(event) => {
                    const query = event.target.value;
                    setProjectQuery(query);
                    setProjectIndex(0);
                    setBrowserIndex(0);
                    setBrowser(null);
                    setError(null);
                    if (!query.startsWith("/")) directoryRequest.current += 1;
                  }}
                  onKeyDown={handleBrowserKeyDown}
                />
              </div>
              {isDirectoryQuery && (
                <button className="secret-button" onClick={() => void chooseProject()}>
                  Choose <kbd>⌘ Enter</kbd>
                </button>
              )}
            </div>
            <div className="secret-picker-section">{isDirectoryQuery ? "Folders" : "Projects"}</div>
            <div
              className="secret-picker-list"
              role="listbox"
              aria-label={isDirectoryQuery ? "Folders" : "Projects"}
            >
              {isDirectoryQuery
                ? directories.map((entry, index) => (
                    <button
                      id={`secret-picker-entry-${index}`}
                      className="secret-picker-entry"
                      key={entry.path}
                      role="option"
                      aria-selected={browserIndex === index}
                      data-active={browserIndex === index}
                      onMouseEnter={() => setBrowserIndex(index)}
                      onFocus={() => setBrowserIndex(index)}
                      onClick={() => {
                        setBrowserIndex(index);
                        void browseDirectory(entry.path);
                      }}
                    >
                      <span className="secret-picker-entry-icon" aria-hidden="true"></span>
                      {entry.name}
                    </button>
                  ))
                : filteredProjects.map((project, index) => (
                    <button
                      id={`secret-project-option-${index}`}
                      className="secret-project-option"
                      key={`${project.hostId}:${project.name}:${project.path}`}
                      role="option"
                      aria-selected={projectIndex === index}
                      data-active={projectIndex === index}
                      onMouseEnter={() => setProjectIndex(index)}
                      onFocus={() => setProjectIndex(index)}
                      onClick={() => void chooseKnownProject(project)}
                    >
                      <span className="secret-project-mark" aria-hidden="true">
                        {project.name.slice(0, 2).toLocaleUpperCase()}
                      </span>
                      <span className="secret-project-option-copy">
                        <span>{project.name}</span>
                        <small>
                          {hosts.find((host) => host.id === project.hostId)?.name ?? "Machine"} ·{" "}
                          {project.path}
                        </small>
                      </span>
                      {index < 9 && <kbd>⌘ {index + 1}</kbd>}
                    </button>
                  ))}
              {isDirectoryQuery && !browser && <div className="secret-empty">Loading folders…</div>}
              {isDirectoryQuery && browser && directories.length === 0 && (
                <div className="secret-empty">No subfolders here.</div>
              )}
              {!isDirectoryQuery && filteredProjects.length === 0 && (
                <div className="secret-empty">
                  No known projects match. Type / to browse folders.
                </div>
              )}
              {error && (
                <div className="secret-picker-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer className="secret-picker-footer">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>Enter</kbd> {isDirectoryQuery ? "Open" : "Select"}
              </span>
              {isDirectoryQuery && (
                <span>
                  <kbd>⌘ Enter</kbd> Choose folder
                </span>
              )}
              {isDirectoryQuery && (
                <span>
                  <kbd>Backspace</kbd> Back
                </span>
              )}
              <span>
                <kbd>Esc</kbd> Close
              </span>
            </footer>
          </section>
        </div>
      )}
      {error && (
        <div className="secret-error" role="alert">
          {error}
        </div>
      )}
      {removeConfirmation && selected && (
        <div
          className="secret-confirm-backdrop"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) setRemoveConfirmation(false);
          }}
        >
          <section
            className="secret-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="secret-remove-title"
            aria-describedby="secret-remove-description"
          >
            <h2 id="secret-remove-title">Remove this alias?</h2>
            <p id="secret-remove-description">
              Remove <strong>{selected.alias}</strong> from the {selected.scope} configuration? The
              Bitwarden item and its value will remain untouched.
            </p>
            {error && (
              <div className="secret-error" role="alert">
                {error}
              </div>
            )}
            <div className="secret-actions">
              <button
                className="secret-button"
                autoFocus
                disabled={busy}
                onClick={() => setRemoveConfirmation(false)}
              >
                Cancel
              </button>
              <button
                className="secret-button secret-button-danger"
                disabled={busy}
                onClick={() => void removeAlias()}
              >
                {busy ? "Removing…" : "Remove alias"}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="secret-content">
        <aside className="secret-list" aria-label="Configured aliases">
          <div className="secret-list-head">
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
            <button
              className="secret-button"
              disabled={busy || !hostId || (activeScope !== "global" && !cwd.trim())}
              onClick={openCreate}
            >
              + New
            </button>
          </div>
          <input
            className="secret-search"
            aria-label="Search aliases"
            placeholder="Search aliases, items, or scope…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div role="listbox" aria-label="Configured aliases">
            {filtered.map((entry, index) => (
              <button
                className="secret-row"
                id={`secret-option-${index}`}
                key={entryId(entry)}
                type="button"
                role="option"
                aria-selected={selectedId === entryId(entry)}
                tabIndex={
                  index === selectedFilteredIndex || (selectedFilteredIndex < 0 && index === 0)
                    ? 0
                    : -1
                }
                data-selected={selectedId === entryId(entry)}
                onClick={() => selectEntry(entry)}
                onKeyDown={(event) => {
                  let nextIndex = index;
                  if (event.key === "ArrowDown")
                    nextIndex = Math.min(index + 1, filtered.length - 1);
                  else if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
                  else if (event.key === "Home") nextIndex = 0;
                  else if (event.key === "End") nextIndex = filtered.length - 1;
                  else return;
                  event.preventDefault();
                  const nextEntry = filtered[nextIndex];
                  if (!nextEntry) return;
                  selectEntry(nextEntry);
                  document.getElementById(`secret-option-${nextIndex}`)?.focus();
                }}
              >
                <span className="secret-row-main">
                  <div className="secret-alias">{entry.alias}</div>
                  <div className="secret-meta">
                    {entry.scope} · {entry.env} · {entry.item}
                  </div>
                </span>
              </button>
            ))}
          </div>
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
              <div className="secret-detail-toolbar">
                <label className="secret-environment">
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
                <div className="secret-primary-actions">
                  <button
                    className="secret-button"
                    disabled={busy || !environment.trim()}
                    onClick={() => void copy()}
                  >
                    Copy
                  </button>
                  <button
                    className="secret-button"
                    disabled={busy || !environment.trim()}
                    onClick={() => (value === null ? void reveal() : setValue(null))}
                  >
                    {value === null ? "Reveal value" : "Hide value"}
                  </button>
                </div>
                <details className="secret-manage">
                  <summary>Manage</summary>
                  <div className="secret-manage-actions">
                    <button className="secret-button" disabled={busy} onClick={openUpdate}>
                      Edit alias / value
                    </button>
                    <button
                      className="secret-button secret-button-danger"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setRemoveConfirmation(true);
                      }}
                    >
                      Remove alias
                    </button>
                  </div>
                </details>
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
