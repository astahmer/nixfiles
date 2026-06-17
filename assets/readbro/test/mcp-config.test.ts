import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

type McpServerEntry = {
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly enabled?: boolean;
};

type CursorMcpJson = {
  readonly mcpServers?: Record<string, McpServerEntry>;
};

type VsCodeMcpJson = {
  readonly servers?: Record<string, McpServerEntry>;
};

type OpenCodeJson = {
  readonly mcp?: Record<string, { readonly enabled?: boolean; readonly command?: ReadonlyArray<string> }>;
};

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as T;

const workspaceServer = readJson<{ command: string; args: Array<string> }>(
  "assets/mcp/readbro-workspace.json",
);

test("workspace readbro MCP fragment points at repo main.ts", () => {
  assert.equal(workspaceServer.command, "node");
  assert.ok(workspaceServer.args.includes("assets/readbro/src/main.ts"));
});

test("Cursor workspace mcp.json registers readbro for local testing", () => {
  const config = readJson<CursorMcpJson>(".cursor/mcp.json");
  const server = config.mcpServers?.readbro;
  assert.ok(server);
  assert.equal(server.command, workspaceServer.command);
  assert.deepEqual(server.args, workspaceServer.args);
});

test("Cursor global mcp.json registers readbro command", () => {
  const config = readJson<CursorMcpJson>("assets/.cursor/mcp.json");
  assert.equal(config.mcpServers?.readbro?.command, "readbro");
});

test("VS Code global mcp.json registers readbro", () => {
  const config = readJson<VsCodeMcpJson>("assets/vscode/mcp.json");
  assert.equal(config.servers?.readbro?.command, "readbro");
});

test("OpenCode config registers readbro", () => {
  const config = readJson<OpenCodeJson>("assets/.config/opencode/opencode.json");
  assert.equal(config.mcp?.readbro?.enabled, true);
  assert.deepEqual(config.mcp?.readbro?.command, ["readbro"]);
});
