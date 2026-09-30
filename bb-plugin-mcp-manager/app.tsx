import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, ServerView } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

type Transport = "streamable-http" | "sse" | "stdio";

const MCP_PICKER_EVENT = "mcp-manager:open-picker";
const PLUS_MENU_LABEL = "Prompt actions";

const statusLabel: Record<ServerView["status"], string> = {
  off: "Disconnected",
  ready: "Connected",
  "needs-auth": "Sign in required",
  error: "Connection error",
};

function McpComposerPicker() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [servers, setServers] = useState<ServerView[]>([]);
  const [search, setSearch] = useState("");
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 12, bottom: 12 });
  const pickerRef = useRef<HTMLElement | null>(null);

  const placePicker = useCallback(() => {
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${PLUS_MENU_LABEL}"]`),
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => right.rect.bottom - left.rect.bottom)[0];
    const pickerWidth = Math.min(416, window.innerWidth - 24);
    const composerMenuWidth = Math.min(256, window.innerWidth - 24);
    const menuGap = 8;
    const leftOfTrigger = trigger
      ? trigger.rect.left - composerMenuWidth - menuGap - pickerWidth
      : 12;
    const rightOfMenu = trigger ? trigger.rect.right + composerMenuWidth + menuGap : 12;
    const left =
      rightOfMenu + pickerWidth <= window.innerWidth - 12
        ? rightOfMenu
        : Math.max(12, leftOfTrigger);
    const bottom = trigger ? Math.max(12, window.innerHeight - trigger.rect.bottom) : 12;
    setPosition({ left, bottom });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("list", null);
      setServers(result.servers);
      setPickerError(null);
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    const openPicker = () => {
      placePicker();
      setIsOpen(true);
      setSearch("");
      void refresh();
    };
    window.addEventListener(MCP_PICKER_EVENT, openPicker);
    return () => window.removeEventListener(MCP_PICKER_EVENT, openPicker);
  }, [placePicker, refresh]);

  useRealtime("mcp-manager-changed", () => {
    if (isOpen) void refresh();
  });

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || pickerRef.current?.contains(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest(`button[aria-label="${PLUS_MENU_LABEL}"]`)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const reposition = () => placePicker();
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, placePicker]);

  const runServerAction = async (
    server: ServerView,
    action: "toggle" | "connect" | "disconnect",
  ) => {
    if (pendingServerId) return;
    setPendingServerId(server.id);
    try {
      if (action === "toggle") {
        await rpc.call("setEnabled", { id: server.id, enabled: !server.enabled });
      } else if (action === "disconnect") {
        await rpc.call("disconnect", { id: server.id });
      } else {
        const result =
          server.status === "needs-auth"
            ? await rpc.call("authenticate", { id: server.id })
            : server.canStart
              ? await rpc.call("start", { id: server.id })
              : await rpc.call("connect", { id: server.id });
        if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl);
      }
      await refresh();
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setPendingServerId(null);
    }
  };

  const filteredServers = servers.filter((server) =>
    server.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed z-[100] w-[min(26rem,calc(100vw-1.5rem))]"
      style={{ left: position.left, bottom: position.bottom }}
    >
      <section
        ref={pickerRef}
        role="dialog"
        aria-labelledby="mcp-picker-title"
        className="max-h-[min(75vh,36rem)] w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="mcp-picker-title" className="text-sm font-semibold">
              MCP servers
            </h2>
            <p className="text-xs text-muted-foreground">
              {servers.filter((server) => server.enabled).length} enabled globally
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close MCP server picker"
            onClick={() => setIsOpen(false)}
          >
            <Icon name="X" className="size-4" />
          </Button>
        </header>
        <div className="p-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search MCP servers…"
            aria-label="Search MCP servers"
          />
        </div>
        {pickerError ? (
          <p
            role="alert"
            className="mx-3 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {pickerError}
          </p>
        ) : null}
        {authorizationUrl ? (
          <a
            href={authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-3 mb-3 block rounded-md border border-border px-3 py-2 text-sm underline underline-offset-4"
          >
            Continue MCP sign-in
          </a>
        ) : null}
        <ul className="max-h-72 divide-y divide-border overflow-y-auto px-3">
          {filteredServers.map((server) => (
            <li key={server.id} className="flex items-center gap-3 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon
                  name={server.transport === "stdio" ? "Terminal" : "Globe"}
                  className="size-4"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{server.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {server.error ? server.error : statusLabel[server.status]}
                </p>
              </div>
              {server.enabled && server.status !== "ready" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingServerId !== null}
                  onClick={() => void runServerAction(server, "connect")}
                >
                  {server.status === "needs-auth" ? "Login" : "Connect"}
                </Button>
              ) : null}
              {server.enabled && server.status === "ready" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pendingServerId !== null}
                  onClick={() => void runServerAction(server, "disconnect")}
                >
                  Disconnect
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant={server.enabled ? "default" : "outline"}
                disabled={pendingServerId !== null}
                aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                aria-pressed={server.enabled}
                onClick={() => void runServerAction(server, "toggle")}
              >
                {server.enabled ? "On" : "Off"}
              </Button>
            </li>
          ))}
          {filteredServers.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">
              {servers.length === 0 ? "No MCP servers registered yet." : "No matching servers."}
            </li>
          ) : null}
        </ul>
        <footer className="flex justify-between border-t border-border p-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
            <Icon name="RefreshCw" className="size-4" /> Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setIsOpen(false);
              navigate.toPluginPanel("servers");
            }}
          >
            Manage servers
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function McpManagerPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("streamable-http");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [env, setEnv] = useState("{}");
  const [startCommand, setStartCommand] = useState("");
  const [startArgs, setStartArgs] = useState("[]");
  const [startCwd, setStartCwd] = useState("");
  const [startEnv, setStartEnv] = useState("{}");
  const [pending, setPending] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [clearHeaders, setClearHeaders] = useState(false);
  const [clearEnv, setClearEnv] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await rpc.call("list", null);
      setServers(result.servers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("mcp-manager-changed", () => {
    void refresh();
  });

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || name.trim() === "") return;
    setPending(true);
    try {
      if (editingServerId) {
        await rpc.call(
          "update",
          transport === "stdio"
            ? {
                id: editingServerId,
                name: name.trim(),
                transport,
                command: command.trim(),
                args: JSON.parse(args),
                cwd: startCwd.trim() || null,
                ...(env.trim() ? { env: JSON.parse(env) } : {}),
                clearEnv,
              }
            : {
                id: editingServerId,
                name: name.trim(),
                transport,
                url: url.trim(),
                ...(headers.trim() ? { headers: JSON.parse(headers) } : {}),
                clearHeaders,
                launcher: startCommand.trim()
                  ? {
                      command: startCommand.trim(),
                      args: JSON.parse(startArgs),
                      cwd: startCwd.trim(),
                    }
                  : null,
                ...(startEnv.trim() ? { launcherEnv: JSON.parse(startEnv) } : {}),
                clearLauncherEnv: clearEnv,
              },
        );
      } else if (transport !== "stdio") {
        await rpc.call("addRemote", {
          name: name.trim(),
          url: url.trim(),
          transport,
          headers: headers.trim() === "" ? {} : JSON.parse(headers),
          ...(startCommand.trim()
            ? {
                launcher: {
                  command: startCommand.trim(),
                  args: JSON.parse(startArgs),
                  cwd: startCwd.trim(),
                  env: JSON.parse(startEnv),
                },
              }
            : {}),
        });
      } else {
        await rpc.call("addStdio", {
          name: name.trim(),
          command: command.trim(),
          args: JSON.parse(args),
          cwd: startCwd.trim() || undefined,
          env: JSON.parse(env),
        });
      }
      setName("");
      setUrl("");
      setHeaders("");
      setCommand("");
      setArgs("[]");
      setEnv("{}");
      setStartCommand("");
      setStartArgs("[]");
      setStartCwd("");
      setStartEnv("{}");
      setEditingServerId(null);
      setClearHeaders(false);
      setClearEnv(false);
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const edit = (server: ServerView) => {
    setEditingServerId(server.id);
    setName(server.name);
    setTransport(server.transport);
    setUrl(server.transport === "stdio" ? "" : server.url);
    setCommand(server.transport === "stdio" ? server.command : "");
    setArgs(server.transport === "stdio" ? JSON.stringify(server.args) : "[]");
    setEnv("");
    setHeaders("");
    setStartCommand(server.transport === "stdio" ? "" : (server.launcher?.command ?? ""));
    setStartArgs(server.transport === "stdio" ? "[]" : JSON.stringify(server.launcher?.args ?? []));
    setStartCwd(server.transport === "stdio" ? (server.cwd ?? "") : (server.launcher?.cwd ?? ""));
    setStartEnv("");
    setClearHeaders(false);
    setClearEnv(false);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingServerId(null);
    setName("");
    setUrl("");
    setCommand("");
    setArgs("[]");
    setEnv("{}");
    setHeaders("");
    setStartCommand("");
    setStartArgs("[]");
    setStartCwd("");
    setStartEnv("{}");
    setClearHeaders(false);
    setClearEnv(false);
  };

  const toggle = async (server: ServerView) => {
    try {
      await rpc.call("setEnabled", { id: server.id, enabled: !server.enabled });
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  };

  const remove = async (server: ServerView) => {
    try {
      await rpc.call("remove", { id: server.id });
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const connect = async (server: ServerView) => {
    try {
      if (server.status === "needs-auth") {
        const result = await rpc.call("authenticate", { id: server.id });
        setAuthorizationUrl(result.authorizationUrl);
        return;
      }
      const result = await rpc.call("connect", { id: server.id });
      if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl);
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  };

  const reauthorize = async (server: ServerView) => {
    try {
      const result = await rpc.call("reauthorize", { id: server.id });
      setAuthorizationUrl(result.authorizationUrl);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const disconnect = async (server: ServerView) => {
    try {
      await rpc.call("disconnect", { id: server.id });
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const start = async (server: ServerView) => {
    try {
      const result = await rpc.call("start", { id: server.id });
      if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl);
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    }
  };

  const stop = async (server: ServerView) => {
    try {
      await rpc.call("stop", { id: server.id });
      setError(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const editedServer = servers?.find((server) => server.id === editingServerId);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <main className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-4 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Global MCP servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage one server list for every project and provider on this BB server.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <Icon name="RefreshCw" className="size-4" /> Refresh
          </Button>
        </div>

        <form onSubmit={add} className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">
                {editingServerId ? "Edit MCP server" : "Add MCP server"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Remote servers can sign in with OAuth. Credentials stay in BB secret storage.
              </p>
            </div>
            <select
              aria-label="Connection type"
              value={transport}
              onChange={(event) =>
                setTransport(
                  event.target.value === "stdio"
                    ? "stdio"
                    : event.target.value === "sse"
                      ? "sse"
                      : "streamable-http",
                )
              }
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="streamable-http">Remote HTTP</option>
              <option value="sse">Remote SSE (legacy)</option>
              <option value="stdio">Local command</option>
            </select>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              aria-label="Server name"
            />
            {transport !== "stdio" ? (
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                aria-label="MCP server URL"
                type="url"
              />
            ) : (
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
                aria-label="Command"
              />
            )}
          </div>
          {transport !== "stdio" ? (
            <div className="mt-3 space-y-3">
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Advanced: request headers
                </summary>
                <textarea
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                  placeholder={'{"Authorization":"Bearer …"}'}
                  aria-label="HTTP headers JSON"
                  className="mt-2 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Headers are stored as secrets. Leave empty for OAuth or public servers.
                </p>
                {editingServerId &&
                editedServer &&
                editedServer.transport !== "stdio" &&
                editedServer.headersConfigured ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={clearHeaders}
                      onChange={(event) => setClearHeaders(event.target.checked)}
                    />
                    Clear saved headers
                  </label>
                ) : null}
              </details>
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Optional: local start command
                </summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Input
                    value={startCommand}
                    onChange={(event) => setStartCommand(event.target.value)}
                    placeholder="pnpm"
                    aria-label="Local start command"
                  />
                  <Input
                    value={startArgs}
                    onChange={(event) => setStartArgs(event.target.value)}
                    placeholder='["dev"]'
                    aria-label="Local start arguments as JSON array"
                  />
                  <Input
                    value={startCwd}
                    onChange={(event) => setStartCwd(event.target.value)}
                    placeholder="/path/to/project"
                    aria-label="Local start working directory"
                    className="sm:col-span-2"
                  />
                  <Input
                    value={startEnv}
                    onChange={(event) => setStartEnv(event.target.value)}
                    placeholder='{"APP_MODE":"development"}'
                    aria-label="Local start environment as JSON object"
                    className="sm:col-span-2"
                  />
                  {editingServerId &&
                  editedServer &&
                  editedServer.transport !== "stdio" &&
                  editedServer.launcherEnvConfigured ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={clearEnv}
                        onChange={(event) => setClearEnv(event.target.checked)}
                      />
                      Clear saved launcher environment
                    </label>
                  ) : null}
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Optional remote HTTP launcher. It runs on the BB host without a shell. Secret
                    environment values remain private.
                  </p>
                </div>
              </details>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                value={startCwd}
                onChange={(event) => setStartCwd(event.target.value)}
                placeholder="/path/to/project"
                aria-label="Working directory"
                className="sm:col-span-2"
              />
              <Input
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder='["-y", "@vendor/mcp"]'
                aria-label="Command arguments as JSON array"
              />
              <Input
                value={env}
                onChange={(event) => setEnv(event.target.value)}
                placeholder={
                  editingServerId &&
                  editedServer?.transport === "stdio" &&
                  editedServer.envConfigured
                    ? "Environment is saved; enter JSON to replace it"
                    : '{"API_KEY":"…"}'
                }
                aria-label="Environment as JSON object"
              />
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Arguments and environment must be valid JSON. Environment values stay in BB secret
                storage.
              </p>
              {editingServerId &&
              editedServer?.transport === "stdio" &&
              editedServer.envConfigured ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={clearEnv}
                    onChange={(event) => setClearEnv(event.target.checked)}
                  />
                  Clear saved environment
                </label>
              ) : null}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              type="submit"
              disabled={
                pending ||
                !name.trim() ||
                (transport !== "stdio" ? !url.trim() : !command.trim()) ||
                (startCommand.trim() !== "" && startCwd.trim() === "")
              }
            >
              <Icon name={editingServerId ? "Save" : "Plus"} className="size-4" />{" "}
              {editingServerId ? "Save changes" : "Add server"}
            </Button>
            {editingServerId ? (
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {authorizationUrl ? (
          <div
            role="status"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
          >
            <span>Continue the MCP server sign-in in a new tab.</span>
            <a
              href={authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-medium underline underline-offset-4"
            >
              Continue sign-in
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Dismiss sign-in link"
              onClick={() => setAuthorizationUrl(null)}
            >
              <Icon name="X" className="size-4" />
            </Button>
          </div>
        ) : null}

        <section className="mt-5" aria-label="Registered MCP servers">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Registered servers</h2>
            <span className="text-xs text-muted-foreground">
              {servers?.filter((server) => server.enabled).length ?? 0} enabled
            </span>
          </div>
          {servers === null ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            >
              Loading servers…
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No MCP servers yet. Add one above.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card px-4">
              {servers.map((server) => (
                <li key={server.id} className="flex items-center gap-3 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon
                      name={server.transport === "stdio" ? "Terminal" : "Globe"}
                      className="size-5"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{server.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {server.transport === "stdio" ? server.command : server.url}
                    </div>
                    <div
                      className={`mt-0.5 text-xs ${server.status === "error" ? "text-destructive" : server.status === "needs-auth" ? "text-amber-600" : "text-muted-foreground"}`}
                    >
                      {statusLabel[server.status]}
                      {server.error ? ` · ${server.error}` : ""}
                    </div>
                  </div>
                  {server.enabled &&
                  (!server.canStart || server.canStop) &&
                  (server.status === "needs-auth" ||
                    server.status === "error" ||
                    server.status === "off") ? (
                    <Button variant="outline" size="sm" onClick={() => void connect(server)}>
                      {server.status === "needs-auth" ? "Login" : "Connect"}
                    </Button>
                  ) : null}
                  {server.enabled &&
                  server.transport !== "stdio" &&
                  server.canStart &&
                  !server.canStop &&
                  server.status !== "ready" ? (
                    <Button variant="outline" size="sm" onClick={() => void start(server)}>
                      Start &amp; connect
                    </Button>
                  ) : null}
                  {server.canStop ? (
                    <Button variant="ghost" size="sm" onClick={() => void stop(server)}>
                      Stop
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => edit(server)}>
                    Edit
                  </Button>
                  {server.enabled && server.transport !== "stdio" && server.status === "ready" ? (
                    <Button variant="ghost" size="sm" onClick={() => void disconnect(server)}>
                      Disconnect
                    </Button>
                  ) : null}
                  {server.enabled &&
                  server.transport !== "stdio" &&
                  server.status === "needs-auth" ? (
                    <Button variant="ghost" size="sm" onClick={() => void reauthorize(server)}>
                      Reauthorize
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant={server.enabled ? "default" : "outline"}
                    size="sm"
                    className="shrink-0"
                    aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                    aria-pressed={server.enabled}
                    onClick={() => void toggle(server)}
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label={`Remove ${server.name}`}
                    disabled={pending}
                    onClick={() => void remove(server)}
                  >
                    <Icon name="Trash2" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "wider-composer-plus-menu",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = `
        [role="dialog"][aria-label="${PLUS_MENU_LABEL}"] {
          width: min(16rem, calc(100vw - 1.5rem)) !important;
          min-width: min(16rem, calc(100vw - 1.5rem)) !important;
        }
      `;
      document.head.append(style);
      signal.addEventListener("abort", () => style.remove(), { once: true });
      return () => style.remove();
    },
  });
  app.composer.customize({
    id: "mcp-server-picker",
    plusMenu: [
      {
        id: "mcp-servers",
        label: "MCP Servers",
        icon: "Plug",
        description: "Connect, disconnect, or disable global MCP servers.",
        run: () => {
          window.dispatchEvent(new Event(MCP_PICKER_EVENT));
        },
      },
    ],
    banners: [{ id: "mcp-picker-dialog", component: McpComposerPicker }],
  });
  app.slots.navPanel({
    id: "servers",
    title: "MCP Servers",
    icon: "Plug",
    path: "servers",
    component: McpManagerPage,
  });
});
