import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { RegistrySuggestion, rpcContract, ServerView } from "./server";
import { catalogServers } from "./catalog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

type Transport = "streamable-http" | "sse" | "stdio";
type CustomTransport = "streamable-http" | "stdio";

type CustomServerDraft = {
  name: string;
  transport: CustomTransport;
  url: string;
  headers: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
};

const emptyCustomServerDraft: CustomServerDraft = {
  name: "",
  transport: "streamable-http",
  url: "",
  headers: "",
  command: "",
  args: "[]",
  cwd: "",
  env: "{}",
};

const MCP_PICKER_EVENT = "mcp-manager:open-picker";
const PLUS_MENU_LABEL = "Prompt actions";

type PickerAnchor = { left: number; top: number; right: number; bottom: number };

const RefreshGlyph = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
  </svg>
);

const statusLabel: Record<ServerView["status"], string> = {
  off: "Disconnected",
  ready: "Connected",
  "needs-auth": "Sign in required",
  error: "Connection error",
};

const endpointKey = (value: string) => {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    return value;
  }
};

function McpComposerPicker() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [servers, setServers] = useState<ServerView[]>([]);
  const [search, setSearch] = useState("");
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"toggle" | "connect" | "disconnect" | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [browseSearch, setBrowseSearch] = useState("");
  const [registryServers, setRegistryServers] = useState<RegistrySuggestion[]>([]);
  const [isRegistryLoading, setIsRegistryLoading] = useState(false);
  const [registrySearchError, setRegistrySearchError] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState(emptyCustomServerDraft);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const pickerAnchor = useRef<PickerAnchor | null>(null);
  const pickerRef = useRef<HTMLElement | null>(null);
  const browseDialogRef = useRef<HTMLElement | null>(null);
  const customDialogRef = useRef<HTMLElement | null>(null);

  const placePicker = useCallback((anchor = pickerAnchor.current) => {
    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${PLUS_MENU_LABEL}"]`),
    )
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => right.rect.bottom - left.rect.bottom)[0];
    const pickerWidth = Math.min(360, window.innerWidth - 24);
    const pickerHeight = Math.min(pickerRef.current?.offsetHeight ?? 280, window.innerHeight - 24);
    const menu = anchor ?? (trigger ? trigger.rect : null);
    if (!menu) {
      setPosition({ left: 12, top: 12 });
      return;
    }
    const rightOfMenu = menu.right + 8;
    const leftOfMenu = menu.left - pickerWidth - 8;
    const left =
      rightOfMenu + pickerWidth <= window.innerWidth - 12 ? rightOfMenu : Math.max(12, leftOfMenu);
    const top = Math.min(Math.max(12, menu.top), window.innerHeight - pickerHeight - 12);
    setPosition({ left, top });
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await rpc.call("list", null);
      setServers(result.servers);
      setPickerError(null);
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    const openPicker = (event: Event) => {
      const anchor =
        event instanceof CustomEvent && event.detail instanceof DOMRect
          ? {
              left: event.detail.left,
              top: event.detail.top,
              right: event.detail.right,
              bottom: event.detail.bottom,
            }
          : null;
      pickerAnchor.current = anchor;
      placePicker(anchor);
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
    const query = browseSearch.trim();
    if (!isBrowseOpen || query.length < 2) {
      setRegistryServers([]);
      setIsRegistryLoading(false);
      setRegistrySearchError(null);
      return;
    }

    let isCurrent = true;
    setRegistryServers([]);
    setIsRegistryLoading(true);
    setRegistrySearchError(null);
    const timeout = window.setTimeout(() => {
      void rpc
        .call("searchRegistry", { query })
        .then((result) => {
          if (isCurrent) setRegistryServers(result.servers);
        })
        .catch(() => {
          if (isCurrent) setRegistrySearchError("The public MCP Registry search is unavailable.");
        })
        .finally(() => {
          if (isCurrent) setIsRegistryLoading(false);
        });
    }, 250);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [browseSearch, isBrowseOpen, rpc]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    placePicker();
  }, [authorizationUrl, isOpen, pendingServerId, pickerError, placePicker, servers.length]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isCustomOpen) {
        setIsCustomOpen(false);
        return;
      }
      if (isBrowseOpen) {
        setIsBrowseOpen(false);
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isBrowseOpen, isCustomOpen, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || pickerRef.current?.contains(event.target)) return;
      if (
        browseDialogRef.current?.contains(event.target) ||
        customDialogRef.current?.contains(event.target)
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(`button[aria-label="${PLUS_MENU_LABEL}"]`)
      ) {
        return;
      }
      setIsOpen(false);
      setIsBrowseOpen(false);
      setIsCustomOpen(false);
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
    setPendingAction(action);
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
      const message = cause instanceof Error ? cause.message : String(cause);
      await refresh();
      setPickerError(message);
    } finally {
      setPendingServerId(null);
      setPendingAction(null);
    }
  };

  const filteredServers = servers.filter((server) =>
    server.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const filteredCatalog = catalogServers.filter((server) =>
    `${server.name} ${server.description} ${server.category}`
      .toLowerCase()
      .includes(browseSearch.trim().toLowerCase()),
  );
  const filteredRegistryServers = registryServers.filter(
    (server) =>
      !filteredCatalog.some(
        (catalogServer) => endpointKey(catalogServer.url) === endpointKey(server.url),
      ),
  );

  const addCatalogServer = async (catalogServer: (typeof catalogServers)[number]) => {
    if (pendingServerId) return;
    const existingServer = servers.find(
      (server) =>
        server.transport !== "stdio" && endpointKey(server.url) === endpointKey(catalogServer.url),
    );
    if (existingServer) {
      setPickerError(`${catalogServer.name} is already registered.`);
      return;
    }
    setPendingServerId(catalogServer.url);
    try {
      const result = await rpc.call("addRemote", {
        name: catalogServer.name,
        url: catalogServer.url,
        transport: "streamable-http",
      });
      setAuthorizationUrl(result.authorizationUrl);
      setPickerError(null);
      setIsBrowseOpen(false);
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await refresh();
      setPickerError(message);
    } finally {
      setPendingServerId(null);
    }
  };

  const addRegistryServer = async (registryServer: RegistrySuggestion) => {
    if (pendingServerId) return;
    const existingServer = servers.find(
      (server) =>
        server.transport !== "stdio" && endpointKey(server.url) === endpointKey(registryServer.url),
    );
    if (existingServer) {
      setPickerError(`${registryServer.name} is already registered.`);
      return;
    }
    setPendingServerId(registryServer.url);
    try {
      const result = await rpc.call("addRemote", {
        name: registryServer.name,
        url: registryServer.url,
        transport: registryServer.transport,
      });
      setAuthorizationUrl(result.authorizationUrl);
      setPickerError(null);
      setIsBrowseOpen(false);
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await refresh();
      setPickerError(message);
    } finally {
      setPendingServerId(null);
    }
  };

  const addCustomServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingServerId || !customDraft.name.trim()) return;
    setPendingServerId("custom");
    try {
      if (customDraft.transport === "stdio") {
        await rpc.call("addStdio", {
          name: customDraft.name.trim(),
          command: customDraft.command.trim(),
          args: JSON.parse(customDraft.args),
          cwd: customDraft.cwd.trim() || undefined,
          env: JSON.parse(customDraft.env),
        });
      } else {
        const result = await rpc.call("addRemote", {
          name: customDraft.name.trim(),
          url: customDraft.url.trim(),
          transport: "streamable-http",
          headers: customDraft.headers.trim() ? JSON.parse(customDraft.headers) : {},
        });
        setAuthorizationUrl(result.authorizationUrl);
      }
      setCustomDraft(emptyCustomServerDraft);
      setIsCustomOpen(false);
      setPickerError(null);
      await refresh();
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setPendingServerId(null);
    }
  };

  if (!isOpen && !isBrowseOpen && !isCustomOpen) return null;

  return createPortal(
    <>
      {isOpen ? (
        <div
          className="fixed z-[100] w-[min(22.5rem,calc(100vw-1.5rem))]"
          style={{ left: position.left, top: position.top }}
        >
          <section
            ref={pickerRef}
            role="dialog"
            aria-labelledby="mcp-picker-title"
            className="flex max-h-[min(75vh,36rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
          >
            <div className="sticky top-0 z-10 shrink-0 bg-popover">
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 id="mcp-picker-title" className="shrink-0 text-sm font-semibold">
                    MCP servers
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {servers.filter((server) => server.enabled).length} enabled globally
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close MCP server picker"
                  onClick={() => {
                    setIsOpen(false);
                    setIsBrowseOpen(false);
                    setIsCustomOpen(false);
                  }}
                >
                  <Icon name="X" className="size-4" />
                </Button>
              </header>
              <div className="shrink-0 border-b border-border bg-popover p-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search MCP servers…"
                  aria-label="Search MCP servers"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {pickerError ? (
                <p
                  role="alert"
                  className="mx-3 mb-3 mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {pickerError}
                </p>
              ) : null}
              {authorizationUrl ? (
                <a
                  href={authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mx-3 mb-3 mt-2 block rounded-md border border-border px-3 py-2 text-sm underline underline-offset-4"
                >
                  Continue MCP sign-in
                </a>
              ) : null}
              <ul className="divide-y divide-border px-3">
                {isLoading && servers.length === 0 ? (
                  <li
                    className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    <RefreshGlyph className="size-4 animate-spin" /> Loading MCP servers…
                  </li>
                ) : null}
                {filteredServers.map((server) => (
                  <li
                    key={server.id}
                    className="flex items-center gap-3 py-2.5"
                    aria-busy={pendingServerId === server.id}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon
                        name={server.transport === "stdio" ? "Terminal" : "Globe"}
                        className="size-4"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{server.name}</p>
                      <p
                        className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
                        aria-live="polite"
                      >
                        {pendingServerId === server.id ? (
                          <RefreshGlyph className="size-3 shrink-0 animate-spin" />
                        ) : null}
                        <span className="truncate">
                          {pendingServerId === server.id
                            ? pendingAction === "connect"
                              ? "Connecting…"
                              : pendingAction === "disconnect"
                                ? "Disconnecting…"
                                : "Updating…"
                            : server.error || statusLabel[server.status]}
                        </span>
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
                    <button
                      type="button"
                      role="switch"
                      aria-checked={server.enabled}
                      disabled={pendingServerId !== null}
                      aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${server.enabled ? "bg-emerald-600" : "bg-muted-foreground/40"}`}
                      onClick={() => void runServerAction(server, "toggle")}
                    >
                      <span
                        className={`absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${server.enabled ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </button>
                  </li>
                ))}
                {!isLoading && filteredServers.length === 0 ? (
                  <li className="py-6 text-center text-sm text-muted-foreground">
                    {servers.length === 0
                      ? "No MCP servers registered yet."
                      : "No matching servers."}
                  </li>
                ) : null}
              </ul>
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isRefreshing}
                aria-busy={isRefreshing}
                aria-label="Refresh MCP servers"
                onClick={async () => {
                  setIsRefreshing(true);
                  await refresh();
                  setIsRefreshing(false);
                }}
              >
                <RefreshGlyph className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsOpen(false);
                    navigate.toPluginPanel("servers");
                  }}
                >
                  <Icon name="Settings" className="size-4" />
                  Manage
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setBrowseSearch("");
                    setPickerError(null);
                    setIsOpen(false);
                    setIsBrowseOpen(true);
                  }}
                >
                  <Icon name="Plus" className="size-4" /> Add MCP
                </Button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
      {isBrowseOpen ? (
        <div className="fixed inset-0 z-[10000] bg-black/60">
          <section
            ref={browseDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-browse-title"
            className="absolute left-1/2 top-1/2 flex max-h-[58vh] w-[calc(100vw_-_2rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl sm:max-w-[64rem]"
            style={{
              left: "50%",
              maxHeight: "min(58vh, 32rem)",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(64rem, calc(100vw - 2rem))",
            }}
          >
            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-[1_1_24rem] items-baseline gap-3">
                <h2 id="mcp-browse-title" className="shrink-0 text-base font-semibold">
                  Browse MCPs
                </h2>
                <p className="truncate text-sm text-muted-foreground">
                  Official hosted servers from their providers.
                </p>
              </div>
              <Input
                value={browseSearch}
                onChange={(event) => {
                  setBrowseSearch(event.target.value);
                  setPickerError(null);
                }}
                placeholder="Search providers and Registry…"
                aria-label="Search provider servers and the public MCP Registry"
                maxLength={80}
                autoFocus
                className="h-9 w-56 shrink-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close MCP browser"
                onClick={() => setIsBrowseOpen(false)}
              >
                <Icon name="X" className="size-5" />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {!browseSearch.trim() ||
                "custom mcp add your own".includes(browseSearch.toLowerCase()) ? (
                  <button
                    type="button"
                    className="flex min-h-20 items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-state-hover"
                    onClick={() => {
                      setCustomDraft(emptyCustomServerDraft);
                      setIsBrowseOpen(false);
                      setIsCustomOpen(true);
                    }}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon name="Plus" className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Custom MCP</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Add your own MCP server
                      </span>
                    </span>
                  </button>
                ) : null}
                {filteredCatalog.map((catalogServer) => {
                  const alreadyAdded = servers.some(
                    (server) =>
                      server.transport !== "stdio" &&
                      endpointKey(server.url) === endpointKey(catalogServer.url),
                  );
                  return (
                    <article
                      key={catalogServer.url}
                      className="flex min-h-24 items-center gap-2.5 rounded-lg border border-border bg-card p-2.5"
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg p-1"
                        style={{
                          backgroundColor:
                            catalogServer.iconBackground === "light" ? "#ffffff" : "#232323",
                        }}
                      >
                        <img
                          src={`data:image/svg+xml,${encodeURIComponent(catalogServer.icon)}`}
                          alt=""
                          className="size-6 object-contain"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{catalogServer.name}</h3>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {catalogServer.category}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                          {catalogServer.description}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <a
                            href={catalogServer.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          >
                            Provider docs
                          </a>
                          <Button
                            type="button"
                            size="sm"
                            disabled={alreadyAdded || pendingServerId !== null}
                            onClick={() => void addCatalogServer(catalogServer)}
                          >
                            {alreadyAdded
                              ? "Added"
                              : pendingServerId === catalogServer.url
                                ? "Adding…"
                                : "Add"}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {filteredRegistryServers.map((registryServer) => {
                  const alreadyAdded = servers.some(
                    (server) =>
                      server.transport !== "stdio" &&
                      endpointKey(server.url) === endpointKey(registryServer.url),
                  );
                  return (
                    <article
                      key={registryServer.registryName}
                      className="flex min-h-24 items-center gap-2.5 rounded-lg border border-border bg-card p-2.5"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon name="Globe" className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-sm font-medium">{registryServer.name}</h3>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Registry
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                          {registryServer.description}
                        </p>
                        <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                          <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={`${registryServer.registryName} · ${registryServer.endpointHost}`}
                          >
                            {registryServer.endpointHost}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            disabled={alreadyAdded || pendingServerId !== null}
                            onClick={() => void addRegistryServer(registryServer)}
                          >
                            {alreadyAdded
                              ? "Added"
                              : pendingServerId === registryServer.url
                                ? "Adding…"
                                : "Add"}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {isRegistryLoading ? (
                  <p
                    className="col-span-full flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <RefreshGlyph className="size-3 animate-spin" /> Searching the public MCP
                    Registry…
                  </p>
                ) : null}
                {pickerError ? (
                  <p
                    role="alert"
                    className="col-span-full rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {pickerError}
                  </p>
                ) : null}
                {registrySearchError ? (
                  <p
                    role="status"
                    className="col-span-full rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                  >
                    {registrySearchError}
                  </p>
                ) : null}
                {browseSearch.trim().length === 1 && filteredCatalog.length === 0 ? (
                  <p className="col-span-full py-4 text-center text-xs text-muted-foreground">
                    Type one more character to search the public Registry.
                  </p>
                ) : null}
                {browseSearch.trim().length >= 2 &&
                filteredCatalog.length === 0 &&
                filteredRegistryServers.length === 0 &&
                !isRegistryLoading &&
                !registrySearchError ? (
                  <p className="col-span-full py-4 text-center text-xs text-muted-foreground">
                    No directly connectable servers matched this search.
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <p>Registry listings are not endorsements. Check each endpoint before adding.</p>
                <a
                  href="https://registry.modelcontextprotocol.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Explore the public MCP Registry
                </a>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {isCustomOpen ? (
        <div className="fixed inset-0 z-[10000] bg-black/60">
          <section
            ref={customDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-custom-title"
            className="absolute left-1/2 top-1/2 flex max-h-[78vh] w-[calc(100vw_-_2rem)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl sm:left-[calc(50%_+_10rem)] sm:w-[min(32rem,_calc(100vw_-_20rem))]"
            style={{
              left: "calc(50% + 10rem)",
              maxHeight: "min(64vh, 38rem)",
              top: "calc(50% - 5rem)",
              transform: "translate(-50%, -50%)",
              width: "min(32rem, calc(100vw - 20rem))",
            }}
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 id="mcp-custom-title" className="text-xl font-semibold">
                  Add a Custom MCP
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add a remote URL or a local command.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close custom MCP form"
                onClick={() => setIsCustomOpen(false)}
              >
                <Icon name="X" className="size-5" />
              </Button>
            </header>
            <form
              onSubmit={(event) => void addCustomServer(event)}
              className="min-h-0 space-y-4 overflow-y-auto p-5"
            >
              <label className="block space-y-2 text-sm">
                <span>Name</span>
                <Input
                  value={customDraft.name}
                  onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })}
                  placeholder="my-mcp-server"
                  aria-label="Custom MCP server name"
                  required
                />
              </label>
              <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  aria-pressed={customDraft.transport === "streamable-http"}
                  className={`rounded-md px-3 py-2 text-sm ${customDraft.transport === "streamable-http" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setCustomDraft({ ...customDraft, transport: "streamable-http" })}
                >
                  URL
                </button>
                <button
                  type="button"
                  aria-pressed={customDraft.transport === "stdio"}
                  className={`rounded-md px-3 py-2 text-sm ${customDraft.transport === "stdio" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setCustomDraft({ ...customDraft, transport: "stdio" })}
                >
                  Command
                </button>
              </div>
              {customDraft.transport === "streamable-http" ? (
                <>
                  <label className="block space-y-2 text-sm">
                    <span>Server URL</span>
                    <Input
                      value={customDraft.url}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, url: event.target.value })
                      }
                      type="url"
                      placeholder="https://example.com/mcp"
                      aria-label="Custom MCP server URL"
                      required
                    />
                  </label>
                  <details className="rounded-lg border border-border px-3 py-2">
                    <summary className="cursor-pointer text-sm">Advanced: request headers</summary>
                    <textarea
                      value={customDraft.headers}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, headers: event.target.value })
                      }
                      placeholder={'{"Authorization":"Bearer …"}'}
                      aria-label="Custom MCP request headers as JSON"
                      className="mt-3 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Headers are stored as secrets. Leave empty for OAuth or public servers.
                    </p>
                  </details>
                </>
              ) : (
                <>
                  <label className="block space-y-2 text-sm">
                    <span>Command</span>
                    <Input
                      value={customDraft.command}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, command: event.target.value })
                      }
                      placeholder="npx"
                      aria-label="Custom MCP command"
                      required
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Adding starts this command on the BB host. Only add commands you trust.
                  </p>
                  <label className="block space-y-2 text-sm">
                    <span>Arguments (JSON array)</span>
                    <Input
                      value={customDraft.args}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, args: event.target.value })
                      }
                      placeholder='["-y", "@vendor/mcp"]'
                      aria-label="Custom MCP command arguments as JSON array"
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span>Working directory (optional)</span>
                    <Input
                      value={customDraft.cwd}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, cwd: event.target.value })
                      }
                      placeholder="/path/to/project"
                      aria-label="Custom MCP working directory"
                    />
                  </label>
                  <details className="rounded-lg border border-border px-3 py-2">
                    <summary className="cursor-pointer text-sm">Advanced: environment</summary>
                    <Input
                      value={customDraft.env}
                      onChange={(event) =>
                        setCustomDraft({ ...customDraft, env: event.target.value })
                      }
                      placeholder={'{"API_KEY":"…"}'}
                      aria-label="Custom MCP environment as JSON object"
                      className="mt-3"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      The command starts on the BB host when you add this server. Environment values
                      are stored as secrets.
                    </p>
                  </details>
                </>
              )}
              {pickerError ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {pickerError}
                </p>
              ) : null}
              <footer className="sticky bottom-0 flex items-center justify-between border-t border-border bg-popover pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setIsCustomOpen(false);
                    setIsBrowseOpen(true);
                  }}
                >
                  Browse MCPs
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pendingServerId !== null ||
                    !customDraft.name.trim() ||
                    (customDraft.transport === "streamable-http"
                      ? !customDraft.url.trim()
                      : !customDraft.command.trim())
                  }
                >
                  <Icon name="Plus" className="size-4" />
                  {pendingServerId === "custom" ? "Adding…" : "Add MCP"}
                </Button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>,
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
        const result = await rpc.call("addRemote", {
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
        if (result.authorizationUrl) setAuthorizationUrl(result.authorizationUrl);
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
            <RefreshGlyph className="size-4" /> Refresh
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
          const composerMenu =
            document.querySelector<HTMLElement>(`[role="menu"][aria-label="${PLUS_MENU_LABEL}"]`) ??
            document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${PLUS_MENU_LABEL}"]`);
          const mcpMenuItem = Array.from(
            composerMenu?.querySelectorAll<HTMLElement>("[role='menuitem'], button") ?? [],
          ).find((item) => item.textContent?.trim().startsWith("MCP Servers"));
          window.dispatchEvent(
            new CustomEvent(MCP_PICKER_EVENT, {
              detail:
                mcpMenuItem?.getBoundingClientRect() ??
                composerMenu?.getBoundingClientRect() ??
                null,
            }),
          );
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
