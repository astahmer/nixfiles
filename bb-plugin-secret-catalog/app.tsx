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
const maskSecret = (value: string) => {
  const characters = [...value];
  if (characters.length <= 8) return "•".repeat(characters.length);
  return `${characters.slice(0, 4).join("")}••••${characters.slice(-4).join("")}`;
};
const entryScope = (scope: string): MutableScope =>
  scope === "global" || scope === "local" ? scope : "project";
type SecretIconName = "eye" | "eye-off" | "copy" | "edit" | "remove";
const SecretIcon = ({ name }: { name: SecretIconName }) => (
  <svg
    aria-hidden="true"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {name === "eye" && (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
    {name === "eye-off" && (
      <>
        <path d="m3 3 18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a15.8 15.8 0 0 1-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1 0 2-.2 2.8-.5" />
      </>
    )}
    {name === "copy" && (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    )}
    {name === "edit" && (
      <>
        <path d="M12 20h9" />
        <path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" />
      </>
    )}
    {name === "remove" && (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2m3 0-1 14H6L5 6" />
        <path d="M10 11v5m4-5v5" />
      </>
    )}
  </svg>
);

const styles = `
.secret-page{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--foreground);background:var(--background);font:13px/1.45 var(--font-sans,system-ui)}
.secret-toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)}.secret-brand{font-size:15px;font-weight:650;white-space:nowrap;margin-right:8px}.secret-input,.secret-button{border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--foreground);padding:7px 10px;font:inherit}.secret-input{background:var(--background);min-width:90px}.secret-host{width:min(260px,28vw);flex:0 1 auto}.secret-project-picker{display:flex;min-width:0;flex:1}.secret-project-picker .secret-path{width:100%;border-radius:6px 0 0 6px}.secret-project-picker .secret-button{border-radius:0 6px 6px 0}.secret-button{cursor:pointer;white-space:nowrap}.secret-button:hover,.secret-row:hover{background:var(--accent)}.secret-button:disabled{opacity:.5;cursor:default}.secret-content{display:flex;min-height:0;flex:1}.secret-list{width:min(38%,390px);min-width:260px;overflow:auto;border-right:1px solid var(--border)}.secret-detail{min-width:0;flex:1;overflow:auto}.secret-search{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--border);padding:9px 12px;background:var(--background);color:var(--foreground);outline:none}.secret-row{width:100%;display:flex;gap:8px;align-items:center;padding:6px 12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-row[data-selected=true]{background:var(--accent)}.secret-row:focus-visible,.secret-search:focus-visible,.secret-input:focus-visible,.secret-button:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}.secret-row-main{min-width:0;flex:1}.secret-alias{font-weight:600;line-height:1.25;overflow-wrap:anywhere}.secret-meta,.secret-muted{color:var(--muted-foreground);font-size:11px}.secret-row .secret-meta{line-height:1.25}.secret-detail-title{padding:14px 16px;border-bottom:1px solid var(--border);font-weight:650}.secret-detail-toolbar{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}.secret-environment{display:flex;align-items:center;gap:8px;color:var(--muted-foreground);font-size:11px}.secret-environment .secret-input{width:130px}.secret-primary-actions,.secret-manage-actions{display:flex;gap:6px;align-items:center}.secret-manage{position:relative}.secret-manage summary{padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;list-style:none}.secret-manage summary::-webkit-details-marker{display:none}.secret-manage-actions{padding-top:7px}.secret-value{margin:14px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--card);font:12px/1.5 var(--font-mono,monospace);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.secret-actions{display:flex;gap:8px;padding:12px 14px;flex-wrap:wrap}.secret-empty{padding:22px 16px;text-align:center;color:var(--muted-foreground)}.secret-error{padding:10px 16px;color:var(--destructive);border-bottom:1px solid var(--border)}
.secret-editor{padding:16px;display:flex;flex-direction:column;gap:12px;max-width:600px}.secret-editor label{display:flex;flex-direction:column;gap:5px}.secret-editor input,.secret-editor select{border:1px solid var(--border);border-radius:6px;background:var(--background);color:var(--foreground);padding:8px}.secret-editor-note{color:var(--muted-foreground);font-size:11px}
.secret-list-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border)}.secret-scope{display:flex;min-width:0;gap:2px}.secret-scope button{border:0;border-radius:5px;background:transparent;color:var(--muted-foreground);padding:6px 8px;cursor:pointer;font:inherit;font-size:12px}.secret-scope button[data-active=true]{background:var(--accent);color:var(--foreground)}.secret-list-head .secret-button{padding:6px 9px}.secret-picker-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:rgb(0 0 0/.58)}.secret-picker{display:flex;flex-direction:column;width:min(720px,92vw);max-height:min(760px,84vh);padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--card);color:var(--foreground);box-shadow:0 18px 60px #000a}.secret-picker-header{display:flex;align-items:center;gap:8px}.secret-picker-path{min-width:0;flex:1}.secret-picker-path input{width:100%;box-sizing:border-box;border:0;background:transparent;color:var(--foreground);font:14px/1.4 var(--font-mono,monospace);outline:none}.secret-picker-section{padding:12px 4px 6px;color:var(--muted-foreground);font-size:11px}.secret-picker-list{min-height:120px;overflow:auto}.secret-picker-entry{display:flex;width:100%;align-items:center;gap:10px;padding:7px 9px;border:0;border-radius:6px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-picker-entry[data-active=true],.secret-picker-entry:hover{background:var(--accent)}.secret-picker-entry:focus-visible{outline:2px solid var(--ring,var(--primary))}.secret-picker-entry-icon{width:18px;color:var(--muted-foreground)}.secret-picker-footer{display:flex;justify-content:center;gap:14px;padding:10px 4px 2px;border-top:1px solid var(--border);color:var(--muted-foreground);font-size:11px}.secret-picker-footer kbd{padding:2px 5px;border:1px solid var(--border);border-radius:4px;color:var(--foreground)}
.secret-confirm-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgb(0 0 0/.62)}.secret-confirm{width:min(440px,100%);padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--card);color:var(--foreground);box-shadow:0 16px 48px #000a}.secret-confirm h2{margin:0 0 8px;font-size:16px}.secret-confirm p{margin:0 0 16px;color:var(--muted-foreground)}.secret-button-danger{border-color:var(--destructive);background:var(--destructive);color:var(--destructive-foreground,#fff)}.secret-button-danger:hover{filter:brightness(1.08)}
.secret-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.secret-scope button:disabled{opacity:.45;cursor:default}.secret-picker-header .secret-button{display:flex;align-items:center;gap:4px}.secret-picker-header .secret-button kbd{margin-left:5px;color:var(--muted-foreground);font-size:10px}.secret-picker-entry-icon{position:relative;display:flex;align-items:center}.secret-picker-entry-icon:before{content:"";display:block;width:13px;height:9px;border:1.5px solid currentColor;border-radius:2px}.secret-picker-entry-icon:after{content:"";position:absolute;top:1px;left:2px;width:5px;height:2px;border:1.5px solid currentColor;border-bottom:0;border-radius:2px 2px 0 0}.secret-toolbar .secret-project-picker .secret-path{border-radius:6px;cursor:pointer}.secret-project-picker .secret-path:hover{border-color:var(--ring,var(--primary))}.secret-picker{width:min(1000px,86vw);max-height:min(780px,84vh);padding:16px 10px 0;overflow:hidden}.secret-picker-header{padding:0 10px 12px;border-bottom:1px solid var(--border)}.secret-picker-header .secret-button{flex:none}.secret-picker-path input{height:44px;padding:0 8px;font:16px/1.4 var(--font-sans,system-ui)}.secret-picker-section{padding:16px 16px 8px;font-size:12px}.secret-picker-list{max-height:min(620px,65vh);min-height:160px;padding:0 7px 8px;overflow:auto}.secret-project-option{display:flex;width:100%;min-height:70px;align-items:center;gap:12px;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--foreground);text-align:left;font:inherit;cursor:pointer}.secret-project-option[data-active=true],.secret-project-option:hover{background:var(--accent)}.secret-project-option:focus-visible{outline:2px solid var(--ring,var(--primary))}.secret-project-option kbd{margin-left:auto;color:var(--muted-foreground)}.secret-project-mark{display:grid;width:28px;height:28px;flex:none;place-items:center;border-radius:7px;background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--primary);font-size:10px;font-weight:700}.secret-project-option:nth-child(6n + 2) .secret-project-mark{background:#ff910022;color:#ff9100}.secret-project-option:nth-child(6n + 3) .secret-project-mark{background:#00bcd422;color:#00bcd4}.secret-project-option:nth-child(6n + 4) .secret-project-mark{background:#8b5cf622;color:#a78bfa}.secret-project-option:nth-child(6n + 5) .secret-project-mark{background:#10b98122;color:#10b981}.secret-project-option-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;font-size:15px}.secret-project-option-copy small{overflow:hidden;color:var(--muted-foreground);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.secret-picker-footer{justify-content:flex-start;gap:18px;padding:12px 16px;background:var(--background)}.secret-picker-error{padding:10px 16px;color:var(--destructive)}
@media(max-width:700px){.secret-toolbar{flex-wrap:wrap}.secret-brand{width:100%}.secret-host{width:40%}.secret-project-picker{flex:1}.secret-content{flex-direction:column}.secret-list{width:100%;min-width:0;max-height:48%;border-right:0;border-bottom:1px solid var(--border)}.secret-path{width:60vw}.secret-list-head{flex-wrap:wrap}}
.secret-picker{width:min(620px,calc(100vw - 32px));max-height:min(520px,78vh);padding:8px 7px 0;border-radius:12px}.secret-picker-header{padding:0 7px 6px;gap:5px}.secret-picker-path input{height:36px;font-size:14px}.secret-picker-section{padding:8px 10px 4px;font-size:11px}.secret-picker-list{max-height:min(390px,60vh);min-height:0;padding:0 4px 5px}.secret-project-option{min-height:42px;gap:8px;padding:5px 7px;border-radius:6px}.secret-project-mark{width:20px;height:20px;border-radius:5px;font-size:9px}.secret-project-option-copy{gap:0;font-size:13px}.secret-project-option-copy small{font-size:10px}.secret-picker-entry{min-height:32px;padding:4px 8px}.secret-picker-footer{gap:10px;padding:7px 9px;font-size:10px}.secret-picker-footer kbd{padding:1px 4px}
.secret-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:18px 20px 14px;border-bottom:1px solid var(--border)}.secret-heading h1{display:flex;align-items:center;gap:10px;margin:0;font-size:20px;line-height:1.2}.secret-count{padding:3px 8px;border-radius:999px;background:var(--accent);color:var(--muted-foreground);font-size:11px;font-weight:500}.secret-heading p{margin:6px 0 0;color:var(--muted-foreground);font-size:12px}.secret-header-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.secret-button-primary{background:var(--foreground);color:var(--background);font-weight:600}.secret-button-primary:hover{filter:brightness(.9)}.secret-contextbar{display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--border)}.secret-contextbar .secret-host{width:min(260px,32%);flex:none}.secret-contextbar .secret-project-picker{flex:1}.secret-contextbar .secret-path{height:34px}.secret-scope{flex:none}.secret-search-wrap{padding:12px 20px 10px}.secret-search{height:38px;border:1px solid var(--border);border-radius:7px;padding:0 12px}.secret-table-scroll{min-height:0;flex:1;overflow:auto;padding:0 20px 20px}.secret-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;border:1px solid var(--border);border-radius:8px;overflow:hidden}.secret-table th{padding:10px 12px;background:var(--accent);color:var(--muted-foreground);font-size:10px;font-weight:650;letter-spacing:.045em;text-align:left;text-transform:uppercase}.secret-table td{padding:9px 12px;border-top:1px solid var(--border);vertical-align:middle}.secret-table tbody tr:hover{background:color-mix(in srgb,var(--accent) 36%,transparent)}.secret-table tbody tr[data-selected=true]{background:var(--accent)}.secret-variable{display:flex;min-width:140px;flex-direction:column;gap:3px}.secret-variable-button{padding:0;border:0;background:transparent;color:var(--foreground);text-align:left;font:600 12px/1.3 var(--font-mono,monospace);overflow-wrap:anywhere;cursor:pointer}.secret-variable-button:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:2px}.secret-variable small,.secret-description small{color:var(--muted-foreground);font-size:10px}.secret-description{display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}.secret-value-cell{display:flex;min-width:155px;align-items:center;gap:4px}.secret-masked-value,.secret-inline-value{min-width:0;flex:1;overflow:hidden;font:12px/1.4 var(--font-mono,monospace);text-overflow:ellipsis;white-space:nowrap}.secret-masked-value{color:var(--muted-foreground)}.secret-inline-value{color:var(--foreground);user-select:text}.secret-icon-button{display:grid;width:28px;height:28px;flex:none;place-items:center;border:0;border-radius:5px;background:transparent;color:var(--muted-foreground);font:16px/1 var(--font-sans,system-ui);cursor:pointer}.secret-icon-button:hover{background:var(--accent);color:var(--foreground)}.secret-icon-button:focus-visible{outline:2px solid var(--ring,var(--primary));outline-offset:-2px}.secret-row-actions{display:flex;align-items:center;justify-content:flex-end;gap:2px;white-space:nowrap}.secret-table th:last-child{text-align:right}.secret-table-empty{padding:38px 14px!important;color:var(--muted-foreground);text-align:center}.secret-notice{margin:0 20px 12px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;color:var(--muted-foreground);font-size:11px}.secret-editor-backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:20px;background:rgb(0 0 0/.58)}.secret-editor{width:min(480px,calc(100vw - 32px));max-height:90vh;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 18px 60px #000a}.secret-editor h2{margin:0;padding:16px 18px;border-bottom:1px solid var(--border);font-size:16px}.secret-editor-fields{display:flex;flex-direction:column;gap:12px;padding:16px 18px}.secret-editor .secret-actions{padding:0 18px 16px}.secret-empty-page{padding:38px 16px;color:var(--muted-foreground);text-align:center}.secret-scope-label{margin:0 4px 0 8px;color:var(--muted-foreground);font-size:11px}@media(max-width:760px){.secret-header{flex-wrap:wrap;padding:14px}.secret-header-actions{width:100%;justify-content:flex-start}.secret-contextbar{flex-wrap:wrap;padding:8px 14px}.secret-contextbar .secret-host{width:100%;max-width:none}.secret-contextbar .secret-project-picker{flex:1 1 65%}.secret-scope{width:100%;overflow:auto}.secret-search-wrap{padding:10px 14px}.secret-table-scroll{padding:0 14px 14px}.secret-table{min-width:680px}}
.secret-button-primary:hover{background:color-mix(in srgb,var(--foreground) 88%,transparent);color:var(--background);filter:none}.secret-notice{position:fixed;right:20px;bottom:20px;z-index:25;width:min(420px,calc(100vw - 40px));margin:0;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--foreground);box-shadow:0 8px 28px #0008;font-size:12px;pointer-events:none;animation:secret-toast-in 140ms ease-out}@keyframes secret-toast-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
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
  const [valueMode, setValueMode] = useState<"preview" | "full">("preview");
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
      [entry.alias, entry.item, entry.envKey, entry.field, entry.env, entry.scope].some((field) =>
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
    setValueMode("preview");
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

  const reveal = async (entry = selected) => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    setSelectedId(entryId(entry));
    setEnvironment(entry.env);
    setValue(null);
    setMessage(null);
    try {
      const result = await rpc.call("get", {
        hostId,
        cwd: cwd.trim() || "/",
        alias: entry.alias,
        environment: entry.env,
        scope: entryScope(entry.scope),
      });
      setValue(result.value);
      setValueMode("preview");
      setMessage("Partial preview visible. Select again to reveal the full value.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (entry = selected) => {
    if (!entry) return;
    setBusy(true);
    setError(null);
    setSelectedId(entryId(entry));
    setEnvironment(entry.env);
    setValue(null);
    try {
      const result = await rpc.call("copy", {
        hostId,
        cwd: cwd.trim() || "/",
        alias: entry.alias,
        environment: entry.env,
        scope: entryScope(entry.scope),
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

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const openUpdate = (entry = selected) => {
    if (!entry) return;
    setSelectedId(entryId(entry));
    setEnvironment(entry.env);
    setDraftAlias(entry.alias);
    setDraftValue("");
    setDraftScope(entryScope(entry.scope));
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
      <header className="secret-header">
        <div className="secret-heading">
          <h1>
            Secret Catalog <span className="secret-count">{entries.length} secrets</span>
          </h1>
          <p>Aliases from the secret CLI. Values stay hidden until you reveal them.</p>
        </div>
        <div className="secret-header-actions">
          <button className="secret-button" disabled={busy || !hostId} onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            className="secret-button secret-button-primary"
            disabled={busy || !hostId || (activeScope !== "global" && !cwd.trim())}
            onClick={openCreate}
          >
            + Add Secret
          </button>
        </div>
      </header>
      <div className="secret-contextbar">
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
              {host.name}
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
        <nav className="secret-scope" aria-label="Secret scope">
          {(["all", "project", "global", "local"] as const).map((scope) => (
            <button
              key={scope}
              data-active={activeScope === scope}
              disabled={(scope === "project" || scope === "local") && !cwd.trim()}
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
      </div>
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
      {editorMode && (
        <div
          className="secret-editor-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closeEditor();
          }}
        >
          <form
            className="secret-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void saveValue();
            }}
          >
            <h2>{editorMode === "create" ? "Add secret" : `Edit ${draftAlias}`}</h2>
            <div className="secret-editor-fields">
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
                className="secret-button secret-button-primary"
                type="submit"
                disabled={busy || (!draftValue && editorMode === "create")}
              >
                {busy ? "Saving…" : "Save through secret CLI"}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="secret-search-wrap">
        <input
          className="secret-search"
          aria-label="Search secrets"
          placeholder="Filter by variable name, service, or alias…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {message && <div className="secret-notice" role="status">{message}</div>}
      <div className="secret-table-scroll">
        <table className="secret-table">
          <colgroup>
            <col style={{ width: "30%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">Description / service</th>
              <th scope="col">Value</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, index) => {
              const id = entryId(entry);
              const isSelected = selectedId === id;
              const hasValue = isSelected && value !== null;
              const isFullyRevealed = hasValue && valueMode === "full";
              return (
                <tr key={id} data-selected={isSelected}>
                  <td>
                    <div className="secret-variable">
                      <button
                        className="secret-variable-button"
                        id={`secret-option-${index}`}
                        type="button"
                        aria-pressed={isSelected}
                        tabIndex={
                          index === selectedFilteredIndex || (selectedFilteredIndex < 0 && index === 0)
                            ? 0
                            : -1
                        }
                        onClick={() => selectEntry(entry)}
                        onKeyDown={(event) => {
                          let nextIndex = index;
                          if (event.key === "ArrowDown") nextIndex = Math.min(index + 1, filtered.length - 1);
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
                        {entry.envKey}
                      </button>
                      <small>{entry.alias} · {entry.scope} · {entry.env}</small>
                    </div>
                  </td>
                  <td>
                    <div className="secret-description">
                      <span>{entry.item}</span>
                      <small>{entry.field}</small>
                    </div>
                  </td>
                  <td>
                    <div className="secret-value-cell">
                      <span className={isFullyRevealed ? "secret-inline-value" : "secret-masked-value"}>
                        {hasValue
                          ? isFullyRevealed
                            ? value || "(empty value)"
                            : maskSecret(value ?? "") || "(empty value)"
                          : "••••••••••••"}
                      </span>
                      <button
                        className="secret-icon-button"
                        type="button"
                        aria-label={
                          !hasValue
                            ? `Preview ${entry.alias}`
                            : isFullyRevealed
                              ? `Hide ${entry.alias}`
                              : `Reveal full ${entry.alias}`
                        }
                        title={
                          !hasValue
                            ? "Preview value"
                            : isFullyRevealed
                              ? "Hide value"
                              : "Reveal full value"
                        }
                        disabled={busy}
                        onClick={() => {
                          if (!hasValue) void reveal(entry);
                          else if (!isFullyRevealed) setValueMode("full");
                          else setValue(null);
                        }}
                      >
                        <SecretIcon name={isFullyRevealed ? "eye-off" : "eye"} />
                      </button>
                      <button
                        className="secret-icon-button"
                        type="button"
                        aria-label={`Copy ${entry.alias}`}
                        title="Copy with secret CLI"
                        disabled={busy}
                        onClick={() => void copy(entry)}
                      >
                        <SecretIcon name="copy" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="secret-row-actions">
                      <button
                        className="secret-icon-button"
                        type="button"
                        aria-label={`Edit ${entry.alias}`}
                        title="Edit alias or value"
                        disabled={busy}
                        onClick={() => openUpdate(entry)}
                      >
                        <SecretIcon name="edit" />
                      </button>
                      <button
                        className="secret-icon-button"
                        type="button"
                        aria-label={`Remove ${entry.alias}`}
                        title="Remove alias"
                        disabled={busy}
                        onClick={() => {
                          selectEntry(entry);
                          setError(null);
                          setRemoveConfirmation(true);
                        }}
                      >
                        <SecretIcon name="remove" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="secret-table-empty" colSpan={4}>
                  {entries.length === 0
                    ? `No ${activeScope} secrets found for this location.`
                    : "No secrets match your filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "secret-catalog",
    title: "Secret Catalog",
    icon: "secret-catalog/lock",
    path: "secrets",
    component: Page,
  });
});
