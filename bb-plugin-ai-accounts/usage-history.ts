import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type UsageDatabase = ReturnType<BbPluginApi["storage"]["database"]>;
type ThreadEventRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>>[number];

const tokenUsagePayloadSchema = z.object({
  last: z.object({
    inputTokens: z.number().finite().nonnegative(),
    cachedInputTokens: z.number().finite().nonnegative(),
    cacheReadInputTokens: z.number().finite().nonnegative().optional(),
    cacheWriteInputTokens: z.number().finite().nonnegative().optional(),
    outputTokens: z.number().finite().nonnegative(),
    reasoningOutputTokens: z.number().finite().nonnegative(),
    totalTokens: z.number().finite().nonnegative(),
  }).passthrough(),
}).passthrough();

export type UsageTokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export const usageMigrations = [
  `CREATE TABLE quota_snapshots (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    window_key TEXT NOT NULL,
    label TEXT NOT NULL,
    used_percent REAL NOT NULL CHECK (used_percent >= 0 AND used_percent <= 100),
    resets_at TEXT,
    window_duration_minutes INTEGER,
    captured_at INTEGER NOT NULL
  );
  CREATE INDEX quota_snapshots_range_idx ON quota_snapshots(captured_at, account_id, host_id);
  CREATE INDEX quota_snapshots_latest_idx ON quota_snapshots(account_id, host_id, window_key, resets_at, captured_at);
  CREATE TABLE quota_poll_state (
    account_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    last_attempt_at INTEGER NOT NULL,
    last_success_at INTEGER,
    PRIMARY KEY (account_id, host_id)
  );
  CREATE TABLE token_usage (
    source_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    source TEXT NOT NULL,
    thread_id TEXT,
    project_id TEXT,
    model TEXT,
    occurred_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'complete')),
    input_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL,
    cache_read_input_tokens INTEGER NOT NULL,
    cache_write_input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    reasoning_output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL
  );
  CREATE INDEX token_usage_range_idx ON token_usage(occurred_at, account_id, model);
  CREATE INDEX token_usage_thread_idx ON token_usage(thread_id, source);
  CREATE TABLE thread_usage_cursor (
    thread_id TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0,
    pending_usage TEXT,
    last_scanned_at INTEGER NOT NULL
  );
  CREATE TABLE usage_source_state (
    account_id TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    last_scanned_at INTEGER,
    PRIMARY KEY (account_id, source)
  );
  CREATE TABLE usage_source_cursor (
    source_key TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    source TEXT NOT NULL,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    line_index INTEGER NOT NULL DEFAULT 0,
    watermark INTEGER NOT NULL DEFAULT 0,
    tie_id TEXT NOT NULL DEFAULT '',
    state_json TEXT,
    last_scanned_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE usage_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
];

export const decodeUsageTokenTotals = (value: unknown): UsageTokenTotals | null => {
  const parsed = tokenUsagePayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  const tokenUsage = parsed.data.last;
  return {
    inputTokens: tokenUsage.inputTokens,
    cachedInputTokens: tokenUsage.cachedInputTokens,
    cacheReadInputTokens: tokenUsage.cacheReadInputTokens ?? tokenUsage.cachedInputTokens,
    cacheWriteInputTokens: tokenUsage.cacheWriteInputTokens ?? 0,
    outputTokens: tokenUsage.outputTokens,
    reasoningOutputTokens: tokenUsage.reasoningOutputTokens,
    totalTokens: tokenUsage.totalTokens,
  };
};

export const toNonnegativeInteger = (value: number) => Math.max(0, Math.round(value));

type AccountUsageIdentity = {
  id: string;
  name: string;
  provider: string;
  providerId: string;
};

type UsageThread = {
  id: string;
  providerId: string;
  hostId: string;
  projectId: string | null;
};

type StoredPendingUsage = UsageTokenTotals & { occurredAt: number };

const insertTokenUsage = (db: UsageDatabase, input: {
  sourceId: string;
  account: AccountUsageIdentity;
  hostId: string;
  source: string;
  threadId: string | null;
  projectId: string | null;
  model: string | null;
  occurredAt: number;
  status: "active" | "complete";
  totals: UsageTokenTotals;
}) => {
  db.prepare(`INSERT INTO token_usage (
    source_id, account_id, account_name, provider, provider_id, host_id, source,
    thread_id, project_id, model, occurred_at, status, input_tokens,
    cached_input_tokens, cache_read_input_tokens, cache_write_input_tokens,
    output_tokens, reasoning_output_tokens, total_tokens
  ) VALUES (
    @sourceId, @accountId, @accountName, @provider, @providerId, @hostId, @source,
    @threadId, @projectId, @model, @occurredAt, @status, @inputTokens,
    @cachedInputTokens, @cacheReadInputTokens, @cacheWriteInputTokens,
    @outputTokens, @reasoningOutputTokens, @totalTokens
  ) ON CONFLICT(source_id) DO UPDATE SET
    occurred_at = excluded.occurred_at,
    status = excluded.status,
    input_tokens = excluded.input_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    cache_read_input_tokens = excluded.cache_read_input_tokens,
    cache_write_input_tokens = excluded.cache_write_input_tokens,
    output_tokens = excluded.output_tokens,
    reasoning_output_tokens = excluded.reasoning_output_tokens,
    total_tokens = excluded.total_tokens`).run({
      sourceId: input.sourceId,
      accountId: input.account.id,
      accountName: input.account.name,
      provider: input.account.provider,
      providerId: input.account.providerId,
      hostId: input.hostId,
      source: input.source,
      threadId: input.threadId,
      projectId: input.projectId,
      model: input.model,
      occurredAt: input.occurredAt,
      status: input.status,
      ...input.totals,
    });
};

export const storeThreadUsageEvents = (input: {
  db: UsageDatabase;
  thread: UsageThread;
  account: AccountUsageIdentity;
  events: ThreadEventRow[];
}) => {
  const existing = input.db.prepare("SELECT last_seq, pending_usage FROM thread_usage_cursor WHERE thread_id = ?").get(input.thread.id) as
    | { last_seq: number; pending_usage: string | null }
    | undefined;
  let lastSeq = existing?.last_seq ?? 0;
  let pendingUsage: StoredPendingUsage | null = null;
  if (existing?.pending_usage) {
    try {
      pendingUsage = JSON.parse(existing.pending_usage) as StoredPendingUsage;
    } catch {
      pendingUsage = null;
    }
  }

  const processEvents = input.db.transaction(() => {
    for (const event of input.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (event.type === "thread/tokenUsage/updated") {
        const totals = decodeUsageTokenTotals(event.data.tokenUsage);
        if (!totals) continue;
        pendingUsage = { ...totals, occurredAt: event.createdAt };
        insertTokenUsage(input.db, {
          sourceId: `bb:${input.thread.id}:active`,
          account: input.account,
          hostId: input.thread.hostId,
          source: "bb-session",
          threadId: input.thread.id,
          projectId: input.thread.projectId,
          model: null,
          occurredAt: event.createdAt,
          status: "active",
          totals,
        });
      }
      if (event.type === "turn/completed" && pendingUsage) {
        const turnId = event.scope.kind === "turn" ? event.scope.turnId : event.id;
        insertTokenUsage(input.db, {
          sourceId: `bb:${input.thread.id}:${turnId}`,
          account: input.account,
          hostId: input.thread.hostId,
          source: "bb-session",
          threadId: input.thread.id,
          projectId: input.thread.projectId,
          model: null,
          occurredAt: pendingUsage.occurredAt,
          status: "complete",
          totals: pendingUsage,
        });
        input.db.prepare("DELETE FROM token_usage WHERE source_id = ?").run(`bb:${input.thread.id}:active`);
        pendingUsage = null;
      }
    }
    input.db.prepare(`INSERT INTO thread_usage_cursor(thread_id, last_seq, pending_usage, last_scanned_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        last_seq = excluded.last_seq,
        pending_usage = excluded.pending_usage,
        last_scanned_at = excluded.last_scanned_at`).run(
      input.thread.id,
      lastSeq,
      pendingUsage ? JSON.stringify(pendingUsage) : null,
      Date.now(),
    );
  });
  processEvents();
  return lastSeq;
};

export const upsertQuotaWindow = (db: UsageDatabase, input: {
  account: AccountUsageIdentity;
  hostId: string;
  windowKey: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  windowDurationMinutes: number | null;
  capturedAt: number;
}) => {
  db.prepare(`INSERT INTO quota_snapshots (
    account_id, account_name, provider, provider_id, host_id, window_key, label,
    used_percent, resets_at, window_duration_minutes, captured_at
  ) VALUES (
    @accountId, @accountName, @provider, @providerId, @hostId, @windowKey, @label,
    @usedPercent, @resetsAt, @windowDurationMinutes, @capturedAt
  )`).run({
    accountId: input.account.id,
    accountName: input.account.name,
    provider: input.account.provider,
    providerId: input.account.providerId,
    hostId: input.hostId,
    windowKey: input.windowKey,
    label: input.label,
    usedPercent: Math.min(100, Math.max(0, input.usedPercent)),
    resetsAt: input.resetsAt,
    windowDurationMinutes: input.windowDurationMinutes,
    capturedAt: input.capturedAt,
  });
};

export const upsertQuotaPollState = (db: UsageDatabase, input: {
  account: AccountUsageIdentity;
  hostId: string;
  status: string;
  message: string | null;
  attemptedAt: number;
  succeeded: boolean;
}) => {
  db.prepare(`INSERT INTO quota_poll_state (
    account_id, account_name, provider, provider_id, host_id, status, message,
    last_attempt_at, last_success_at
  ) VALUES (
    @accountId, @accountName, @provider, @providerId, @hostId, @status, @message,
    @attemptedAt, @lastSuccessAt
  ) ON CONFLICT(account_id, host_id) DO UPDATE SET
    account_name = excluded.account_name,
    provider = excluded.provider,
    provider_id = excluded.provider_id,
    status = excluded.status,
    message = excluded.message,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = COALESCE(excluded.last_success_at, quota_poll_state.last_success_at)`).run({
      accountId: input.account.id,
      accountName: input.account.name,
      provider: input.account.provider,
      providerId: input.account.providerId,
      hostId: input.hostId,
      status: input.status,
      message: input.message,
      attemptedAt: input.attemptedAt,
      lastSuccessAt: input.succeeded ? input.attemptedAt : null,
    });
};

export const storeUsageSourceState = (db: UsageDatabase, input: {
  accountId: string;
  source: string;
  status: string;
  message: string | null;
  scannedAt: number;
}) => {
  db.prepare(`INSERT INTO usage_source_state(account_id, source, status, message, last_scanned_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, source) DO UPDATE SET
      status = excluded.status,
      message = excluded.message,
      last_scanned_at = excluded.last_scanned_at`).run(
    input.accountId,
    input.source,
    input.status,
    input.message,
    input.scannedAt,
  );
};

export type { UsageDatabase };

export const usageRangeStart = (range: "24h" | "7d" | "30d" | "90d", now = Date.now()) => {
  const days = range === "24h" ? 1 : Number.parseInt(range, 10);
  return now - days * 24 * 60 * 60 * 1000;
};

export const usageChartBucketMs = (range: "24h" | "7d" | "30d" | "90d") =>
  range === "24h" ? 60 * 60 * 1000 : range === "7d" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

export const toRemainingPercent = (usedPercent: number) =>
  Number.isFinite(usedPercent) && usedPercent >= 0 && usedPercent <= 100 ? 100 - usedPercent : null;
