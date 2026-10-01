import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { scanLocalUsageHistory } from "./usage-sources.ts";
import { decodeUsageTokenTotals, storeThreadUsageEvents, toRemainingPercent, usageMigrations, type UsageDatabase } from "./usage-history.ts";

const createUsageDatabase = () => {
  const db = new Database(":memory:");
  for (const migration of usageMigrations) db.exec(migration);
  return db;
};

test("remaining quota math rejects invalid percentages", () => {
  assert.equal(toRemainingPercent(0), 100);
  assert.equal(toRemainingPercent(100), 0);
  assert.equal(toRemainingPercent(23.5), 76.5);
  assert.equal(toRemainingPercent(-1), null);
  assert.equal(toRemainingPercent(101), null);
  assert.equal(toRemainingPercent(Number.NaN), null);
  assert.equal(toRemainingPercent(Number.POSITIVE_INFINITY), null);
});

test("token payload decoding preserves provider reported categories", () => {
  assert.deepEqual(decodeUsageTokenTotals({ last: {
    inputTokens: 12,
    cachedInputTokens: 3,
    cacheReadInputTokens: 2,
    cacheWriteInputTokens: 1,
    outputTokens: 4,
    reasoningOutputTokens: 5,
    totalTokens: 21,
  } }), {
    inputTokens: 12,
    cachedInputTokens: 3,
    cacheReadInputTokens: 2,
    cacheWriteInputTokens: 1,
    outputTokens: 4,
    reasoningOutputTokens: 5,
    totalTokens: 21,
  });
  assert.equal(decodeUsageTokenTotals({ last: { inputTokens: -1 } }), null);
  assert.equal(decodeUsageTokenTotals(undefined), null);
});

test("BB cumulative usage updates become one completed record per turn", () => {
  const db = createUsageDatabase();
  const input = {
    db: db as UsageDatabase,
    thread: { id: "thread-1", providerId: "ai-account-codex", hostId: "host-1", projectId: "project-1" },
    account: { id: "codex", name: "Codex Alex", provider: "codex" as const, providerId: "ai-account-codex" },
    events: [
      {
        id: "event-token-1", threadId: "thread-1", seq: 1, createdAt: 1000, scope: { kind: "turn" as const, turnId: "turn-1" },
        type: "thread/tokenUsage/updated" as const,
        data: { providerThreadId: "provider-thread", tokenUsage: { last: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 14 }, total: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, reasoningOutputTokens: 1, totalTokens: 14 }, modelContextWindow: 1000 } },
      },
      {
        id: "event-complete-1", threadId: "thread-1", seq: 2, createdAt: 1100, scope: { kind: "turn" as const, turnId: "turn-1" },
        type: "turn/completed" as const,
        data: { providerThreadId: "provider-thread", status: "completed" as const },
      },
      {
        id: "event-token-2", threadId: "thread-1", seq: 3, createdAt: 1200, scope: { kind: "turn" as const, turnId: "turn-2" },
        type: "thread/tokenUsage/updated" as const,
        data: { providerThreadId: "provider-thread", tokenUsage: { last: { inputTokens: 25, cachedInputTokens: 5, outputTokens: 15, reasoningOutputTokens: 10, totalTokens: 50 }, total: { inputTokens: 25, cachedInputTokens: 5, outputTokens: 15, reasoningOutputTokens: 10, totalTokens: 50 }, modelContextWindow: 1000 } },
      },
      {
        id: "event-complete-2", threadId: "thread-1", seq: 4, createdAt: 1300, scope: { kind: "turn" as const, turnId: "turn-2" },
        type: "turn/completed" as const,
        data: { providerThreadId: "provider-thread", status: "completed" as const },
      },
    ],
  };
  storeThreadUsageEvents(input);
  storeThreadUsageEvents(input);
  const rows = db.prepare("SELECT source_id AS sourceId, total_tokens AS totalTokens, status FROM token_usage ORDER BY source_id").all();
  assert.deepEqual(rows, [
    { sourceId: "bb:thread-1:turn-1", totalTokens: 14, status: "complete" },
    { sourceId: "bb:thread-1:turn-2", totalTokens: 50, status: "complete" },
  ]);
  db.close();
});

test("Codex local history scans incrementally without storing transcript text", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "bb-ai-usage-test-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex");
  const sessionsDirectory = join(codexHome, "sessions");
  await mkdir(sessionsDirectory, { recursive: true });
  await writeFile(join(sessionsDirectory, "rollout-test.jsonl"), [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-test" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-10-01T10:00:00.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 7, reasoning_output_tokens: 2, total_tokens: 29 } } } }),
    JSON.stringify({ type: "response_item", payload: { text: "private transcript text" } }),
  ].join("\n") + "\n");
  const db = createUsageDatabase();
  const input = { db: db as UsageDatabase, accounts: [{ id: "codex", displayName: "Codex Alex", provider: "codex" as const, path: codexHome }], hostId: "host-1" };
  await scanLocalUsageHistory(input);
  await scanLocalUsageHistory(input);
  const rows = db.prepare("SELECT source_id AS sourceId, model, total_tokens AS totalTokens, input_tokens AS inputTokens, output_tokens AS outputTokens FROM token_usage").all();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { sourceId: rows[0]?.sourceId, model: "gpt-test", totalTokens: 29, inputTokens: 20, outputTokens: 7 });
  assert.equal(JSON.stringify(rows).includes("private transcript text"), false);
  db.close();
});

test("OpenCode local history scans supported assistant token records once", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "bb-opencode-usage-test-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const xdgDataHome = join(root, "opencode-profile");
  const opencodeDirectory = join(xdgDataHome, "opencode");
  await mkdir(opencodeDirectory, { recursive: true });
  const history = new Database(join(opencodeDirectory, "opencode.db"));
  history.exec("CREATE TABLE session (id TEXT PRIMARY KEY); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);");
  history.prepare("INSERT INTO session(id) VALUES (?)").run("session-1");
  history.prepare("INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run(
    "message-1",
    "session-1",
    1_790_846_400_000,
    1_790_846_401_000,
    JSON.stringify({
      role: "assistant",
      parts: [{ type: "text", text: "private OpenCode transcript" }],
      metadata: {
        time: { created: 1_790_846_400_000, completed: 1_790_846_401_000 },
        assistant: { modelID: "claude-test", tokens: { input: 30, output: 8, reasoning: 3, cache: { read: 12, write: 2 } } },
      },
    }),
  );
  history.close();

  const db = createUsageDatabase();
  const input = { db: db as UsageDatabase, accounts: [{ id: "opencode", displayName: "OpenCode Work", provider: "opencode-go" as const, path: xdgDataHome }], hostId: "host-1" };
  await scanLocalUsageHistory(input);
  await scanLocalUsageHistory(input);
  const rows = db.prepare("SELECT model, total_tokens AS totalTokens, input_tokens AS inputTokens, cache_read_input_tokens AS cacheReadInputTokens, cache_write_input_tokens AS cacheWriteInputTokens FROM token_usage").all();
  assert.deepEqual(rows, [{ model: "claude-test", totalTokens: 55, inputTokens: 30, cacheReadInputTokens: 12, cacheWriteInputTokens: 2 }]);
  assert.equal(JSON.stringify(rows).includes("private OpenCode transcript"), false);
  db.close();
});
