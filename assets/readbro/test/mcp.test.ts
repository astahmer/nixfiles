import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpClient, asCallToolResult, asInitializeResult, asToolsListResult, spawnReadbroMcp } from "./mcp-client.ts";

const EXPECTED_TOOLS = [
  "read_file",
  "search_symbol",
  "blast_radius",
  "session_status",
  "session_gain",
  "session_clear",
] as const;

test("MCP initialize returns readbro server info", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);

  const response = await client.initialize();
  const result = asInitializeResult(response);
  assert.equal(result.serverInfo?.name, "readbro");
  assert.equal(result.serverInfo?.version, "0.4.0");
  assert.equal(result.capabilities?.tools?.listChanged, true);

  client.close();
});

test("MCP tools/list exposes all readbro tools", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/list");
  const tools = asToolsListResult(response).tools ?? [];

  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOLS].sort());

  for (const tool of tools) {
    assert.equal(
      tool.inputSchema.type,
      "object",
      `${tool.name} inputSchema must be type object for MCP clients`,
    );
  }

  client.close();
});

test("MCP tools/call session_status returns cache stats", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/call", {
    name: "session_status",
    arguments: {},
  });

  const result = asCallToolResult(response);
  const text = result.content?.[0]?.text ?? "";
  assert.equal(result.isError, false);
  assert.match(text, /readbro Token Savings/);
  assert.match(text, /Session Scope/);
  assert.doesNotMatch(text, /By Layer/);

  client.close();
});

test("MCP session_status accepts glob and json filters", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/call", {
    name: "session_status",
    arguments: { json: true, scope: "session" },
  });

  const result = asCallToolResult(response);
  const text = result.content?.[0]?.text ?? "";
  assert.equal(result.isError, false);
  const parsed = JSON.parse(text) as { scope: string };
  assert.equal(parsed.scope, "session");

  client.close();
});

test("MCP tools/call read_file returns IR for a temp file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "readbro-mcp-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "sample.ts");
  writeFileSync(file, "export const answer = 42;\n");

  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/call", {
    name: "read_file",
    arguments: { path: file, layer: "L1" },
  });

  const result = asCallToolResult(response);
  const text = result.content?.[0]?.text ?? "";
  assert.equal(result.isError, false);
  assert.ok(text.length > 0);

  client.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("MCP read_file accepts path array for batch reads", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "readbro-mcp-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const a = join(repo, "a.ts");
  const b = join(repo, "b.ts");
  writeFileSync(a, "export const a = 1;\n");
  writeFileSync(b, "export const b = 2;\n");

  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/call", {
    name: "read_file",
    arguments: { path: [a, b], layer: "L1" },
  });

  const result = asCallToolResult(response);
  const text = result.content?.[0]?.text ?? "";
  assert.equal(result.isError, false);
  assert.match(text, /=== .*a\.ts ===/);
  assert.match(text, /=== .*b\.ts ===/);

  client.close();
  rmSync(tmp, { recursive: true, force: true });
});
