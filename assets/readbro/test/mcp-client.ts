import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const mainTs = join(repoRoot, "assets/readbro/src/main.ts");

export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

export type McpInitializeResult = {
  readonly serverInfo?: { readonly name?: string; readonly version?: string };
  readonly capabilities?: { readonly tools?: { readonly listChanged?: boolean } };
};

export type McpToolDescriptor = {
  readonly name: string;
  readonly inputSchema: { readonly type?: string };
};

export type McpToolsListResult = {
  readonly tools?: ReadonlyArray<McpToolDescriptor>;
};

export type McpCallToolResult = {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text: string }>;
  readonly isError?: boolean;
};

export const asInitializeResult = (message: JsonRpcMessage): McpInitializeResult =>
  (message.result ?? {}) as McpInitializeResult;

export const asToolsListResult = (message: JsonRpcMessage): McpToolsListResult =>
  (message.result ?? {}) as McpToolsListResult;

export const asCallToolResult = (message: JsonRpcMessage): McpCallToolResult =>
  (message.result ?? {}) as McpCallToolResult;

export const spawnReadbroMcp = (): ChildProcessWithoutNullStreams =>
  spawn(
    "node",
    [
      "--no-warnings=ExperimentalWarning",
      "--experimental-transform-types",
      "--experimental-strip-types",
      mainTs,
    ],
    { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] },
  );

export class McpClient {
  private nextId = 1;
  private buffer = "";
  private pending = new Map<
    number,
    { resolve: (value: JsonRpcMessage) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.on("exit", (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`readbro MCP exited with code ${code ?? "unknown"}`));
      }
      this.pending.clear();
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (pending) {
            this.pending.delete(message.id);
            pending.resolve(message);
          }
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  send(message: JsonRpcMessage) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown> = {}) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "readbro-test", version: "0" },
    });
    this.notify("notifications/initialized");
    return response;
  }

  close() {
    this.child.kill();
  }
}
