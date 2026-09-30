import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  OAuthClientInformationContext,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthClientMetadata,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const launcherSchema = z
  .object({
    command: z.string().trim().min(1).max(1024),
    args: z.array(z.string().max(4096)).max(64).default([]),
    cwd: z.string().trim().min(1).max(2048),
    env: z.record(z.string(), z.string().max(8192)).default({}),
  })
  .strict();
const launcherViewSchema = z
  .object({
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
  })
  .strict();

const serverConfigSchema = z.discriminatedUnion("transport", [
  z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      transport: z.enum(["streamable-http", "sse"]),
      url: z.string().url().max(2048),
      headers: z
        .record(
          z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
          z
            .string()
            .max(8192)
            .refine((value) => !/[\r\n]/.test(value)),
        )
        .default({}),
      launcher: launcherSchema.optional(),
      enabled: z.boolean(),
      status: z.enum(["off", "ready", "needs-auth", "error"]),
      error: z.string().max(1000).nullable(),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      transport: z.literal("stdio"),
      command: z.string().trim().min(1).max(1024),
      args: z.array(z.string().max(4096)).max(64),
      cwd: z.string().max(2048).optional(),
      env: z.record(z.string(), z.string().max(8192)).default({}),
      enabled: z.boolean(),
      status: z.enum(["off", "ready", "error"]),
      error: z.string().max(1000).nullable(),
    })
    .strict(),
]);

type ServerConfig = z.infer<typeof serverConfigSchema>;
type RemoteServerConfig = Extract<ServerConfig, { transport: "streamable-http" | "sse" }>;
type Connection = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport;
};
type PendingAuthorization = {
  provider: StoredOAuthProvider;
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
};
type OAuthRecord = {
  clients: Record<string, StoredOAuthClientInformation>;
  tokens: Record<string, StoredOAuthTokens>;
  verifier?: string;
  state?: string;
  discovery?: OAuthDiscoveryState;
};

const serverSchema = z.discriminatedUnion("transport", [
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      transport: z.enum(["streamable-http", "sse"]),
      url: z.string().url(),
      enabled: z.boolean(),
      status: z.enum(["off", "ready", "needs-auth", "error"]),
      error: z.string().nullable(),
      canStart: z.boolean(),
      canStop: z.boolean(),
      headersConfigured: z.boolean(),
      launcher: launcherViewSchema.nullable(),
      launcherEnvConfigured: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      transport: z.literal("stdio"),
      command: z.string(),
      args: z.array(z.string()),
      cwd: z.string().nullable(),
      envConfigured: z.boolean(),
      enabled: z.boolean(),
      status: z.enum(["off", "ready", "error"]),
      error: z.string().nullable(),
      canStart: z.boolean(),
      canStop: z.boolean(),
    })
    .strict(),
]);
export type ServerView = z.infer<typeof serverSchema>;
const toolSchema = z
  .object({
    serverId: z.string(),
    serverName: z.string(),
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

export const rpcContract = defineRpcContract({
  list: { input: z.null(), output: z.object({ servers: z.array(serverSchema) }).strict() },
  addRemote: {
    input: z
      .object({
        name: z.string().trim().min(1).max(80),
        url: z.string().url().max(2048),
        transport: z.enum(["streamable-http", "sse"]),
        headers: z.record(z.string(), z.string().max(8192)).default({}),
        launcher: launcherSchema.optional(),
      })
      .strict(),
    output: serverSchema,
  },
  addStdio: {
    input: z
      .object({
        name: z.string().trim().min(1).max(80),
        command: z.string().trim().min(1).max(1024),
        args: z.array(z.string().max(4096)).max(64).default([]),
        cwd: z.string().max(2048).nullable().optional(),
        env: z.record(z.string(), z.string().max(8192)).default({}),
      })
      .strict(),
    output: serverSchema,
  },
  update: {
    input: z.discriminatedUnion("transport", [
      z
        .object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
          transport: z.enum(["streamable-http", "sse"]),
          url: z.string().url().max(2048),
          headers: z.record(z.string(), z.string().max(8192)).optional(),
          clearHeaders: z.boolean().default(false),
          launcher: launcherViewSchema.nullable(),
          launcherEnv: z.record(z.string(), z.string().max(8192)).optional(),
          clearLauncherEnv: z.boolean().default(false),
        })
        .strict(),
      z
        .object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
          transport: z.literal("stdio"),
          command: z.string().trim().min(1).max(1024),
          args: z.array(z.string().max(4096)).max(64),
          cwd: z.string().max(2048).nullable().optional(),
          env: z.record(z.string(), z.string().max(8192)).optional(),
          clearEnv: z.boolean().default(false),
        })
        .strict(),
    ]),
    output: serverSchema,
  },
  setEnabled: {
    input: z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict(),
    output: serverSchema,
  },
  remove: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ removed: z.boolean() }).strict(),
  },
  connect: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ status: z.string(), authorizationUrl: z.string().nullable() }).strict(),
  },
  start: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ status: z.string(), authorizationUrl: z.string().nullable() }).strict(),
  },
  stop: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ stopped: z.boolean() }).strict(),
  },
  tools: { input: z.null(), output: z.object({ tools: z.array(toolSchema) }).strict() },
  authenticate: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ authorizationUrl: z.string() }).strict(),
  },
  reauthorize: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ authorizationUrl: z.string() }).strict(),
  },
  disconnect: {
    input: z.object({ id: z.string().uuid() }).strict(),
    output: z.object({ disconnected: z.boolean() }).strict(),
  },
});

const CHANGED = "mcp-manager-changed";
const TOOL_LIST = "mcp_list_tools";
const TOOL_CALL = "mcp_call_tool";
const MAX_TOOL_OUTPUT_CHARS = 48_000;
const START_TIMEOUT_MS = 30_000;

class StoredOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: URL;
  readonly clientMetadata: OAuthClientMetadata;
  private readonly getRecord: () => Promise<Record<string, OAuthRecord>>;
  private readonly setRecord: (value: Record<string, OAuthRecord>) => Promise<void>;
  private readonly recordKey: string;
  authorizationUrl: URL | null = null;
  expectedState: string | null = null;

  constructor(args: {
    redirectUrl: URL;
    recordKey: string;
    getRecord: () => Promise<Record<string, OAuthRecord>>;
    setRecord: (value: Record<string, OAuthRecord>) => Promise<void>;
  }) {
    this.redirectUrl = args.redirectUrl;
    this.recordKey = args.recordKey;
    this.getRecord = args.getRecord;
    this.setRecord = args.setRecord;
    this.clientMetadata = {
      client_name: "BB MCP Manager",
      redirect_uris: [this.redirectUrl.href],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    };
  }

  private async mutate(update: (record: OAuthRecord) => void) {
    const records = await this.getRecord();
    const record = records[this.recordKey] ?? { clients: {}, tokens: {} };
    update(record);
    records[this.recordKey] = record;
    await this.setRecord(records);
    return record;
  }

  async state() {
    const state = randomUUID();
    this.expectedState = state;
    await this.mutate((record) => {
      record.state = state;
    });
    return state;
  }

  async clientInformation(context?: OAuthClientInformationContext) {
    if (!context) return undefined;
    return (await this.getRecord())[this.recordKey]?.clients[context.issuer];
  }

  async saveClientInformation(
    value: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext,
  ) {
    if (!context) throw new Error("OAuth issuer was not provided when saving client registration");
    await this.mutate((record) => {
      record.clients[context.issuer] = value;
    });
  }

  async tokens(context?: OAuthClientInformationContext) {
    const record = (await this.getRecord())[this.recordKey];
    if (!record) return undefined;
    if (context) return record.tokens[context.issuer];
    return Object.values(record.tokens).at(-1);
  }

  async saveTokens(value: StoredOAuthTokens, context?: OAuthClientInformationContext) {
    if (!context) throw new Error("OAuth issuer was not provided when saving tokens");
    await this.mutate((record) => {
      record.tokens[context.issuer] = value;
    });
  }

  async redirectToAuthorization(url: URL) {
    if (!new Set(["https:", "http:"]).has(url.protocol))
      throw new Error("OAuth authorization URL must use HTTP or HTTPS");
    this.authorizationUrl = url;
  }
  async saveCodeVerifier(value: string) {
    await this.mutate((record) => {
      record.verifier = value;
    });
  }
  async codeVerifier() {
    const value = (await this.getRecord())[this.recordKey]?.verifier;
    if (!value) throw new Error("OAuth PKCE verifier is missing");
    return value;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState) {
    await this.mutate((record) => {
      record.discovery = value;
    });
  }
  async discoveryState() {
    return (await this.getRecord())[this.recordKey]?.discovery;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await this.mutate((record) => {
      if (scope === "all") {
        record.clients = {};
        record.tokens = {};
        delete record.verifier;
        delete record.discovery;
        delete record.state;
      }
      if (scope === "client") record.clients = {};
      if (scope === "tokens") record.tokens = {};
      if (scope === "verifier") {
        delete record.verifier;
        delete record.state;
      }
      if (scope === "discovery") delete record.discovery;
    });
  }
  async clearCallbackState() {
    this.expectedState = null;
    await this.mutate((record) => {
      delete record.state;
      delete record.verifier;
    });
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    serversJson: {
      type: "string",
      label: "MCP server registry",
      description: "Managed by MCP Manager.",
      secret: true,
      default: "[]",
    },
    oauthJson: {
      type: "string",
      label: "MCP OAuth credentials",
      description: "OAuth tokens and PKCE state for registered MCP servers.",
      secret: true,
      default: "{}",
    },
  });
  const connections = new Map<string, Connection>();
  const connectionAttempts = new Map<
    string,
    Promise<{ status: string; authorizationUrl: string | null }>
  >();
  const pendingAuth = new Map<string, PendingAuthorization>();
  const managedProcesses = new Map<string, ChildProcess>();
  const startingProcesses = new Map<
    string,
    Promise<{ status: string; authorizationUrl: string | null }>
  >();
  let serverMutation = Promise.resolve();

  const readServers = async (): Promise<ServerConfig[]> => {
    try {
      return z
        .array(serverConfigSchema)
        .max(64)
        .parse(JSON.parse((await settings.get()).serversJson));
    } catch {
      bb.log.warn("MCP registry could not be read.");
      return [];
    }
  };
  const writeServers = async (servers: ServerConfig[]) => {
    await bb.sdk.plugins.updateSettings({
      pluginId: bb.pluginId,
      values: { serversJson: JSON.stringify(servers) },
    });
    await bb.realtime.publish(CHANGED, {});
  };
  const readOAuth = async (): Promise<Record<string, OAuthRecord>> => {
    try {
      return z
        .record(z.string(), z.unknown())
        .parse(JSON.parse((await settings.get()).oauthJson)) as Record<string, OAuthRecord>;
    } catch {
      return {};
    }
  };
  const writeOAuth = async (records: Record<string, OAuthRecord>) => {
    await bb.sdk.plugins.updateSettings({
      pluginId: bb.pluginId,
      values: { oauthJson: JSON.stringify(records) },
    });
  };
  const findServer = async (id: string) => {
    const server = (await readServers()).find((item) => item.id === id);
    if (!server) throw new Error("MCP server not found");
    return server;
  };
  const publicServer = (server: ServerConfig) =>
    server.transport !== "stdio"
      ? serverSchema.parse({
          id: server.id,
          name: server.name,
          transport: server.transport,
          url: server.url,
          enabled: server.enabled,
          status: server.status,
          error: server.error,
          canStart: Boolean(server.launcher),
          canStop: managedProcesses.has(server.id),
          headersConfigured: Object.keys(server.headers).length > 0,
          launcher: server.launcher
            ? {
                command: server.launcher.command,
                args: server.launcher.args,
                cwd: server.launcher.cwd,
              }
            : null,
          launcherEnvConfigured: Boolean(
            server.launcher && Object.keys(server.launcher.env).length > 0,
          ),
        })
      : serverSchema.parse({
          id: server.id,
          name: server.name,
          transport: server.transport,
          command: server.command,
          args: server.args,
          cwd: server.cwd ?? null,
          envConfigured: Object.keys(server.env).length > 0,
          enabled: server.enabled,
          status: server.status,
          error: server.error,
          canStart: false,
          canStop: false,
        });
  const persistServer = async (server: ServerConfig) => {
    const existing = await readServers();
    if (existing.length >= 64 && !existing.some((candidate) => candidate.id === server.id)) {
      throw new Error("MCP Manager supports up to 64 servers");
    }
    const operation = serverMutation.then(async () => {
      const servers = await readServers();
      const next = servers.some((candidate) => candidate.id === server.id)
        ? servers.map((candidate) => (candidate.id === server.id ? server : candidate))
        : [...servers, server];
      await writeServers(next);
    });
    serverMutation = operation.catch(() => {});
    await operation;
    return publicServer(server);
  };
  const closeConnection = async (id: string) => {
    const flow = pendingAuth.get(id);
    pendingAuth.delete(id);
    if (flow) await flow.client.close().catch(() => {});
    const connection = connections.get(id);
    connections.delete(id);
    if (connection) await connection.client.close().catch(() => {});
  };
  const stopManagedProcess = async (id: string) => {
    const child = managedProcesses.get(id);
    if (!child) return false;
    managedProcesses.delete(id);
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
      return true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    return true;
  };
  const oauthProvider = (server: RemoteServerConfig) => {
    const redirectUrl = new URL(
      `/api/v1/plugins/${encodeURIComponent(bb.pluginId)}/http/oauth/callback`,
      bb.server.loopbackBaseUrl,
    );
    redirectUrl.search = new URLSearchParams({ id: server.id }).toString();
    return new StoredOAuthProvider({
      recordKey: server.id,
      redirectUrl,
      getRecord: readOAuth,
      setRecord: writeOAuth,
    });
  };
  const connectServerOnce = async (
    server: ServerConfig,
  ): Promise<{ status: string; authorizationUrl: string | null }> => {
    await closeConnection(server.id);
    if (server.transport === "stdio") {
      const client = new Client({ name: "bb-mcp-manager", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        ...(server.cwd ? { cwd: server.cwd } : {}),
        env: server.env,
        stderr: "pipe",
      });
      try {
        transport.stderr?.on("data", () => {});
        await client.connect(transport, { timeout: 15_000 });
        connections.set(server.id, { client, transport });
        await persistServer({ ...server, status: "ready", error: null });
        return { status: "ready", authorizationUrl: null };
      } catch {
        await client.close().catch(() => {});
        await persistServer({
          ...server,
          status: "error",
          error: "Connection failed. Check the command and environment.",
        });
        throw new Error("MCP server connection failed. Check its command and configuration.");
      }
    }
    const provider = oauthProvider(server);
    const client = new Client({ name: "bb-mcp-manager", version: "0.1.0" });
    const transport =
      server.transport === "sse"
        ? new SSEClientTransport(new URL(server.url), {
            authProvider: provider,
            requestInit: { headers: server.headers },
          })
        : new StreamableHTTPClientTransport(new URL(server.url), {
            authProvider: provider,
            requestInit: { headers: server.headers },
          });
    try {
      await client.connect(transport, { timeout: 15_000 });
      connections.set(server.id, { client, transport });
      await persistServer({ ...server, status: "ready", error: null });
      return { status: "ready", authorizationUrl: null };
    } catch (error) {
      if (error instanceof UnauthorizedError || UnauthorizedError.isInstance(error)) {
        if (provider.authorizationUrl) pendingAuth.set(server.id, { provider, client, transport });
        else await client.close().catch(() => {});
        await persistServer({ ...server, status: "needs-auth", error: null });
        return { status: "needs-auth", authorizationUrl: provider.authorizationUrl?.href ?? null };
      }
      await client.close().catch(() => {});
      await persistServer({
        ...server,
        status: "error",
        error: "Connection failed. Check the endpoint and headers.",
      });
      throw new Error("MCP server connection failed. Check its endpoint and configuration.");
    }
  };
  const connectServer = (server: ServerConfig) => {
    const current = connectionAttempts.get(server.id);
    if (current) return current;
    const operation = connectServerOnce(server);
    connectionAttempts.set(server.id, operation);
    return operation.finally(() => {
      if (connectionAttempts.get(server.id) === operation) {
        connectionAttempts.delete(server.id);
      }
    });
  };
  const waitForConnectionAttempt = async (id: string) => {
    await connectionAttempts.get(id)?.catch(() => {});
  };
  const endpointResponds = async (server: RemoteServerConfig) => {
    try {
      const response = await fetch(server.url, {
        method: "GET",
        headers: server.headers,
        signal: AbortSignal.timeout(1500),
      });
      await response.body?.cancel().catch(() => {});
      return response.status < 500 && response.status !== 404;
    } catch {
      return false;
    }
  };
  const startManagedServerOnce = async (server: RemoteServerConfig) => {
    if (!server.launcher) throw new Error("No local start command is configured");
    if (await endpointResponds(server)) return connectServer(server);

    let spawnError: Error | undefined;
    let child = managedProcesses.get(server.id);
    if (!child) {
      const launched = spawn(server.launcher.command, server.launcher.args, {
        cwd: server.launcher.cwd,
        env: { ...process.env, ...server.launcher.env },
        detached: process.platform !== "win32",
        stdio: "ignore",
      });
      child = launched;
      managedProcesses.set(server.id, launched);
      launched.once("error", (error) => {
        spawnError = error;
      });
      launched.once("exit", () => {
        if (managedProcesses.get(server.id) !== launched) return;
        managedProcesses.delete(server.id);
        void closeConnection(server.id);
        void findServer(server.id)
          .then((current) =>
            persistServer({
              ...current,
              status: "error",
              error: "The managed server process stopped.",
            }),
          )
          .catch(() => {});
      });
    }

    for (let elapsed = 0; elapsed < START_TIMEOUT_MS; elapsed += 500) {
      if (spawnError) {
        await stopManagedProcess(server.id);
        throw new Error("Could not start the configured command.");
      }
      if (managedProcesses.get(server.id) !== child) {
        throw new Error("The managed process stopped before the MCP endpoint became ready.");
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        await stopManagedProcess(server.id);
        throw new Error("The configured command exited before the MCP endpoint became ready.");
      }
      if (await endpointResponds(server)) return connectServer(server);
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    await stopManagedProcess(server.id);
    throw new Error("The MCP endpoint did not become ready within 30 seconds.");
  };
  const startManagedServer = (server: RemoteServerConfig) => {
    const current = startingProcesses.get(server.id);
    if (current) return current;
    const operation = startManagedServerOnce(server);
    startingProcesses.set(server.id, operation);
    return operation.finally(() => {
      if (startingProcesses.get(server.id) === operation) startingProcesses.delete(server.id);
    });
  };
  const ensureConnected = async (id: string) => {
    const current = connections.get(id);
    if (current) return current;
    const server = await findServer(id);
    if (!server.enabled) throw new Error("MCP server is disabled");
    if (server.status === "needs-auth")
      throw new Error("MCP server needs authentication. Authenticate it in MCP Manager.");
    const result = await connectServer(server);
    if (result.status !== "ready")
      throw new Error(
        result.status === "needs-auth"
          ? "MCP server needs authentication. Authenticate it in MCP Manager."
          : "MCP server could not connect.",
      );
    const connection = connections.get(id);
    if (!connection) throw new Error("MCP server connection did not start");
    return connection;
  };
  const listTools = async () => {
    const servers = (await readServers()).filter((server) => server.enabled);
    const tools = [];
    for (const server of servers) {
      try {
        const connection = await ensureConnected(server.id);
        const result = await connection.client.listTools({});
        tools.push(
          ...result.tools.slice(0, 500 - tools.length).map((tool) => ({
            serverId: server.id,
            serverName: server.name,
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
          })),
        );
      } catch {
        bb.log.warn(`MCP server ${server.id} tool list failed.`);
      }
    }
    return tools;
  };

  bb.http.route(
    "GET",
    "/oauth/callback",
    async (context) => {
      const id = context.req.query("id") ?? "";
      const flow = pendingAuth.get(id);
      if (!flow)
        return context.html("<p>Authentication expired. Return to BB and try again.</p>", 400);
      const params = new URL(context.req.raw.url).searchParams;
      if (params.get("state") !== flow.provider.expectedState) {
        return context.html(
          "<p>Authentication state did not match. Return to BB and try again.</p>",
          400,
        );
      }
      try {
        await flow.transport.finishAuth(params);
        await flow.provider.clearCallbackState();
        await flow.client.close().catch(() => {});
        pendingAuth.delete(id);
        const server = await findServer(id);
        const result = await connectServer(server);
        return context.html(
          `<p>${result.status === "ready" ? "MCP server connected. You can close this tab." : "Authentication finished. Return to BB."}</p>`,
        );
      } catch {
        pendingAuth.delete(id);
        await flow.client.close().catch(() => {});
        await flow.provider.clearCallbackState().catch(() => {});
        const server = await findServer(id);
        await persistServer({ ...server, status: "error", error: "OAuth authorization failed" });
        bb.log.warn(`MCP OAuth callback failed for ${id}.`);
        return context.html("<p>Authentication failed. Return to BB and try again.</p>", 400);
      }
    },
    { auth: "none" },
  );

  bb.agents.registerTool({
    name: TOOL_LIST,
    description: "List tools from globally enabled MCP servers managed by BB.",
    instructions:
      "Call mcp_list_tools to discover currently enabled MCP tools. Use the exact serverId and name in mcp_call_tool.",
    parameters: z.object({}).strict(),
    async execute() {
      const tools = await listTools();
      let visible = tools;
      let output = JSON.stringify({ tools: visible, truncated: false });
      while (output.length > MAX_TOOL_OUTPUT_CHARS && visible.length > 0) {
        visible = visible.slice(0, Math.ceil(visible.length * 0.8));
        output = JSON.stringify({ tools: visible, truncated: true });
      }
      if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
      const summaries = visible.map(({ serverId, serverName, name }) => ({
        serverId,
        serverName,
        name,
      }));
      return JSON.stringify({
        tools: summaries,
        truncated: true,
        message: "Schemas omitted because the MCP catalog exceeded the output limit.",
      });
    },
  });
  bb.agents.registerTool({
    name: TOOL_CALL,
    description: "Call a tool on an enabled global MCP server.",
    instructions:
      "Call mcp_list_tools first. Use the exact serverId and tool name returned by that list.",
    parameters: z
      .object({
        serverId: z.string().uuid(),
        name: z.string().min(1).max(256),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
    async execute(input, context) {
      const server = await findServer(input.serverId);
      if (!server.enabled) throw new Error("MCP server is disabled");
      try {
        const connection = await ensureConnected(input.serverId);
        const result = await connection.client.callTool(
          { name: input.name, arguments: input.arguments },
          { signal: context.signal },
        );
        const output = JSON.stringify(result);
        return output.length <= MAX_TOOL_OUTPUT_CHARS
          ? output
          : JSON.stringify({
              truncated: true,
              preview: output.slice(0, MAX_TOOL_OUTPUT_CHARS - 200),
            });
      } catch {
        throw new Error("MCP tool call failed. Check the server connection and tool arguments.");
      }
    },
  });
  bb.agents.configure(() => ({
    tools: [TOOL_LIST, TOOL_CALL],
    skills: [],
    instructions:
      "Global MCP servers are available through mcp_list_tools and mcp_call_tool. Disabled servers are not callable.",
  }));

  bb.rpc.register(rpcContract, {
    list: async () => ({ servers: (await readServers()).map(publicServer) }),
    addRemote: async (input) => {
      const url = new URL(input.url);
      if (!new Set(["http:", "https:"]).has(url.protocol))
        throw new Error("MCP URL must use HTTP or HTTPS");
      const server = serverConfigSchema.parse({
        id: randomUUID(),
        ...input,
        enabled: true,
        status: "off",
        error: null,
      });
      await persistServer(server);
      if (server.transport !== "stdio" && server.launcher) return publicServer(server);
      await connectServer(server);
      return publicServer(await findServer(server.id));
    },
    addStdio: async (input) => {
      const server = serverConfigSchema.parse({
        id: randomUUID(),
        ...input,
        transport: "stdio",
        enabled: true,
        status: "off",
        error: null,
      });
      await persistServer(server);
      await connectServer(server);
      return publicServer(await findServer(server.id));
    },
    update: async (input) => {
      const previous = await findServer(input.id);
      await waitForConnectionAttempt(input.id);
      await closeConnection(input.id);
      await stopManagedProcess(input.id);
      let updated: ServerConfig;
      if (input.transport === "stdio") {
        updated = serverConfigSchema.parse({
          id: input.id,
          name: input.name,
          transport: "stdio",
          command: input.command,
          args: input.args,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          env: input.clearEnv
            ? {}
            : (input.env ?? (previous.transport === "stdio" ? previous.env : {})),
          enabled: previous.enabled,
          status: "off",
          error: null,
        });
      } else {
        const url = new URL(input.url);
        if (!new Set(["http:", "https:"]).has(url.protocol)) {
          throw new Error("MCP URL must use HTTP or HTTPS");
        }
        updated = serverConfigSchema.parse({
          id: input.id,
          name: input.name,
          transport: input.transport,
          url: input.url,
          headers: input.clearHeaders
            ? {}
            : (input.headers ?? (previous.transport !== "stdio" ? previous.headers : {})),
          ...(input.launcher
            ? {
                launcher: {
                  ...input.launcher,
                  env: input.clearLauncherEnv
                    ? {}
                    : (input.launcherEnv ??
                      (previous.transport !== "stdio" && previous.launcher
                        ? previous.launcher.env
                        : {})),
                },
              }
            : {}),
          enabled: previous.enabled,
          status: "off",
          error: null,
        });
      }
      await persistServer(updated);
      const endpointChanged =
        previous.transport !== updated.transport ||
        (previous.transport !== "stdio" &&
          updated.transport !== "stdio" &&
          previous.url !== updated.url);
      if (endpointChanged) {
        const oauth = await readOAuth();
        delete oauth[input.id];
        await writeOAuth(oauth);
      }
      return publicServer(updated);
    },
    setEnabled: async ({ id, enabled }) => {
      const server = await findServer(id);
      if (!enabled) await waitForConnectionAttempt(id);
      await closeConnection(id);
      if (!enabled) {
        await stopManagedProcess(id);
      }
      return persistServer({ ...server, enabled, status: "off", error: null });
    },
    remove: async ({ id }) => {
      await waitForConnectionAttempt(id);
      await closeConnection(id);
      await stopManagedProcess(id);
      const servers = await readServers();
      const operation = serverMutation.then(async () =>
        writeServers((await readServers()).filter((server) => server.id !== id)),
      );
      serverMutation = operation.catch(() => {});
      await operation;
      const oauth = await readOAuth();
      delete oauth[id];
      await writeOAuth(oauth);
      return { removed: servers.some((server) => server.id === id) };
    },
    connect: async ({ id }) => {
      const server = await findServer(id);
      if (!server.enabled) throw new Error("Enable this MCP server before connecting");
      const result = await connectServer(server);
      return result;
    },
    start: async ({ id }) => {
      const server = await findServer(id);
      if (!server.enabled) throw new Error("Enable this MCP server before starting it");
      if (server.transport === "stdio") throw new Error("Local stdio servers start when connected");
      return startManagedServer(server);
    },
    stop: async ({ id }) => {
      const server = await findServer(id);
      if (server.transport === "stdio")
        throw new Error("Local stdio servers stop when disconnected");
      await waitForConnectionAttempt(id);
      await closeConnection(id);
      const stopped = await stopManagedProcess(id);
      await persistServer({ ...server, status: "off", error: null });
      return { stopped };
    },
    tools: async () => ({ tools: await listTools() }),
    authenticate: async ({ id }) => {
      const server = await findServer(id);
      if (!server.enabled) throw new Error("Enable this MCP server before authenticating");
      if (server.transport === "stdio")
        throw new Error("OAuth is only supported for remote HTTP servers");
      const result = await connectServer(server);
      if (!result.authorizationUrl)
        throw new Error(
          result.status === "ready"
            ? "This server is already connected"
            : "The server did not start an OAuth flow",
        );
      return { authorizationUrl: result.authorizationUrl };
    },
    reauthorize: async ({ id }) => {
      const server = await findServer(id);
      if (!server.enabled) throw new Error("Enable this MCP server before authenticating");
      if (server.transport === "stdio")
        throw new Error("OAuth is only supported for remote HTTP servers");
      await waitForConnectionAttempt(id);
      await closeConnection(id);
      const oauth = await readOAuth();
      delete oauth[id];
      await writeOAuth(oauth);
      const result = await connectServer({ ...server, status: "off", error: null });
      if (!result.authorizationUrl) throw new Error("The server did not start an OAuth flow");
      return { authorizationUrl: result.authorizationUrl };
    },
    disconnect: async ({ id }) => {
      const server = await findServer(id);
      if (server.transport === "stdio")
        throw new Error("OAuth is only supported for remote HTTP servers");
      await waitForConnectionAttempt(id);
      await closeConnection(id);
      const oauth = await readOAuth();
      delete oauth[id];
      await writeOAuth(oauth);
      await persistServer({ ...server, status: "off", error: null });
      return { disconnected: true };
    },
  });

  for (const server of await readServers()) {
    if (server.enabled && server.status !== "needs-auth") {
      void connectServer(server).catch(() =>
        bb.log.warn(`MCP startup connection failed for ${server.id}.`),
      );
    }
  }
  bb.onDispose(async () => {
    await Promise.all([...connectionAttempts.values()].map((attempt) => attempt.catch(() => {})));
    await Promise.all([...connections.keys()].map(closeConnection));
    for (const flow of pendingAuth.values()) await flow.client.close().catch(() => {});
    await Promise.all([...managedProcesses.keys()].map(stopManagedProcess));
  });
}
