import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpClient, spawnReadbroMcp } from "./mcp-client.ts";

const EXPECTED_TOOLS = [
  "read_file",
  "read_files",
  "pack_context",
  "blast_radius",
  "session_status",
  "session_clear",
] as const;

test("MCP initialize returns readbro server info", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);

  const response = await client.initialize();
  assert.equal(response.result?.serverInfo?.name, "readbro");
  assert.equal(response.result?.serverInfo?.version, "0.3.0");
  assert.equal(response.result?.capabilities?.tools?.listChanged, true);

  client.close();
});

test("MCP tools/list exposes all readbro tools", async () => {
  const child = spawnReadbroMcp();
  const client = new McpClient(child);
  await client.initialize();

  const response = await client.request("tools/list");
  const tools = response.result?.tools as Array<{ name: string; inputSchema: { type?: string } }>;
  assert.ok(Array.isArray(tools));

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

  const text = response.result?.content?.[0]?.text as string;
  assert.equal(response.result?.isError, false);
  assert.match(text, /readbro Token Savings/);
  assert.match(text, /Session Scope/);
  assert.match(text, /Raw tokens/);
  assert.match(text, /Billed tokens/);

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

  const text = response.result?.content?.[0]?.text as string;
  assert.equal(response.result?.isError, false);
  assert.ok(text.length > 0);

  client.close();
  rmSync(tmp, { recursive: true, force: true });
});
