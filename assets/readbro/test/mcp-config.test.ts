import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as Record<string, unknown>;

const workspaceServer = readJson("assets/mcp/readbro-workspace.json") as {
  command: string;
  args: Array<string>;
};

test("workspace readbro MCP fragment points at repo main.ts", () => {
  assert.equal(workspaceServer.command, "node");
  assert.ok(workspaceServer.args.includes("assets/readbro/src/main.ts"));
});

test("Cursor workspace mcp.json registers readbro for local testing", () => {
  const config = readJson(".cursor/mcp.json");
  const server = config.mcpServers?.readbro as { command: string; args: Array<string> };
  assert.equal(server.command, workspaceServer.command);
  assert.deepEqual(server.args, workspaceServer.args);
});

test("Cursor global mcp.json registers readbro command", () => {
  const config = readJson("assets/.cursor/mcp.json");
  assert.equal(config.mcpServers?.readbro?.command, "readbro");
});

test("VS Code global mcp.json registers readbro", () => {
  const config = readJson("assets/vscode/mcp.json");
  assert.equal(config.servers?.readbro?.command, "readbro");
});

test("OpenCode config registers readbro", () => {
  const config = readJson("assets/.config/opencode/opencode.json");
  assert.equal(config.mcp?.readbro?.enabled, true);
  assert.deepEqual(config.mcp?.readbro?.command, ["readbro"]);
});
