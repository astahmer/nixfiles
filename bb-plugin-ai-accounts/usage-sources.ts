import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import {
  storeUsageSourceState,
  toNonnegativeInteger,
  type UsageDatabase,
} from "./usage-history.ts";

type SourceAccount = {
  id: string;
  displayName: string;
  provider: "codex" | "opencode-go";
  path: string;
};

const codexTokenSchema = z.object({
  input_tokens: z.number().finite().nonnegative().optional(),
  output_tokens: z.number().finite().nonnegative().optional(),
  cached_input_tokens: z.number().finite().nonnegative().optional(),
  cache_read_input_tokens: z.number().finite().nonnegative().optional(),
  cache_write_input_tokens: z.number().finite().nonnegative().optional(),
  reasoning_output_tokens: z.number().finite().nonnegative().optional(),
  total_tokens: z.number().finite().nonnegative().optional(),
}).passthrough();
const codexEntrySchema = z.object({
  type: z.string().optional(),
  timestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const opencodeTokensSchema = z.object({
  input: z.number().finite().nonnegative().optional(),
  output: z.number().finite().nonnegative().optional(),
  reasoning: z.number().finite().nonnegative().optional(),
  cache: z.object({
    read: z.number().finite().nonnegative().optional(),
    write: z.number().finite().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();
const opencodeMessageSchema = z.object({
  role: z.string(),
  modelID: z.string().optional(),
  tokens: opencodeTokensSchema.optional(),
  time: z.object({
    created: z.number().finite().optional(),
    completed: z.number().finite().optional(),
  }).passthrough().optional(),
  metadata: z.object({
    time: z.object({ created: z.number().finite().optional(), completed: z.number().finite().optional() }).passthrough().optional(),
    assistant: z.object({ modelID: z.string().optional(), tokens: opencodeTokensSchema.optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const MAX_FILES_PER_SCAN = 250;
const MAX_CODEX_FILES_PER_TICK = 12;
const MAX_BYTES_PER_CODEX_FILE = 2_000_000;
const MAX_OPEN_CODE_ROWS_PER_SCAN = 1_000;

const hashSourceKey = (accountId: string, provider: string, filePath: string, inode: number | bigint) =>
  createHash("sha256").update(`${accountId}\0${provider}\0${filePath}\0${inode}`).digest("hex");

const insertLocalTokenEvent = (db: UsageDatabase, input: {
  sourceId: string;
  account: SourceAccount;
  hostId: string;
  source: string;
  model: string | null;
  occurredAt: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}) => {
  db.prepare(`INSERT INTO token_usage (
    source_id, account_id, account_name, provider, provider_id, host_id, source,
    thread_id, project_id, model, occurred_at, status, input_tokens,
    cached_input_tokens, cache_read_input_tokens, cache_write_input_tokens,
    output_tokens, reasoning_output_tokens, total_tokens
  ) VALUES (
    @sourceId, @accountId, @accountName, @provider, @providerId, @hostId, @source,
    NULL, NULL, @model, @occurredAt, 'complete', @inputTokens,
    @cachedInputTokens, @cacheReadInputTokens, @cacheWriteInputTokens,
    @outputTokens, @reasoningOutputTokens, @totalTokens
  ) ON CONFLICT(source_id) DO UPDATE SET
    account_name = excluded.account_name,
    model = excluded.model,
    occurred_at = excluded.occurred_at,
    input_tokens = excluded.input_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    cache_read_input_tokens = excluded.cache_read_input_tokens,
    cache_write_input_tokens = excluded.cache_write_input_tokens,
    output_tokens = excluded.output_tokens,
    reasoning_output_tokens = excluded.reasoning_output_tokens,
    total_tokens = excluded.total_tokens`).run({
      sourceId: input.sourceId,
      accountId: input.account.id,
      accountName: input.account.displayName,
      provider: input.account.provider,
      providerId: `ai-account-${input.account.id}`,
      hostId: input.hostId,
      source: input.source,
      model: input.model,
      occurredAt: input.occurredAt,
      inputTokens: toNonnegativeInteger(input.inputTokens),
      cachedInputTokens: toNonnegativeInteger(input.cachedInputTokens),
      cacheReadInputTokens: toNonnegativeInteger(input.cacheReadInputTokens),
      cacheWriteInputTokens: toNonnegativeInteger(input.cacheWriteInputTokens),
      outputTokens: toNonnegativeInteger(input.outputTokens),
      reasoningOutputTokens: toNonnegativeInteger(input.reasoningOutputTokens),
      totalTokens: toNonnegativeInteger(input.totalTokens),
    });
};

const codexFiles = async (root: string) => {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0 && files.length < MAX_FILES_PER_SCAN) {
    const directory = pending.pop();
    if (directory === undefined) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) files.push(entryPath);
      if (files.length >= MAX_FILES_PER_SCAN) break;
    }
  }
  return files;
};

type CodexCursor = { byte_offset: number; line_index: number; state_json: string | null };

const scanCodexFile = async (input: {
  db: UsageDatabase;
  account: SourceAccount;
  hostId: string;
  filePath: string;
}) => {
  const fileStat = await stat(input.filePath);
  const sourceKey = hashSourceKey(input.account.id, "codex-cli", input.filePath, fileStat.ino);
  const previous = input.db.prepare("SELECT byte_offset, line_index, state_json FROM usage_source_cursor WHERE source_key = ?")
    .get(sourceKey) as CodexCursor | undefined;
  const cursor = previous && previous.byte_offset <= fileStat.size
    ? previous
    : { byte_offset: 0, line_index: 0, state_json: null };
  let model: string | null = null;
  if (cursor.state_json) {
    const parsedState = z.object({ model: z.string().nullable() }).safeParse(JSON.parse(cursor.state_json));
    if (parsedState.success) model = parsedState.data.model;
  }
  if (cursor.byte_offset >= fileStat.size) return true;

  let byteOffset = cursor.byte_offset;
  let lineIndex = cursor.line_index;
  let pending = Buffer.alloc(0);
  const accumulated: Array<{ line: string; lineIndex: number; occurredAt: number }> = [];
  const stream = createReadStream(input.filePath, {
    start: cursor.byte_offset,
    end: Math.min(fileStat.size - 1, cursor.byte_offset + MAX_BYTES_PER_CODEX_FILE - 1),
  });
  for await (const chunkValue of stream) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    pending = Buffer.concat([pending, chunk]);
    let newlineIndex = pending.indexOf(10);
    while (newlineIndex >= 0) {
      const line = pending.subarray(0, newlineIndex);
      byteOffset += newlineIndex + 1;
      lineIndex += 1;
      accumulated.push({ line: line.toString("utf8"), lineIndex, occurredAt: byteOffset });
      pending = pending.subarray(newlineIndex + 1);
      newlineIndex = pending.indexOf(10);
    }
  }

  const applyLines = input.db.transaction(() => {
    for (const entry of accumulated) {
      let decodedJson: unknown;
      try {
        decodedJson = JSON.parse(entry.line);
      } catch {
        continue;
      }
      const decoded = codexEntrySchema.safeParse(decodedJson);
      if (!decoded.success) continue;
      const payload = decoded.data.payload;
      if (!payload) continue;
      if (decoded.data.type === "turn_context" && typeof payload.model === "string") {
        model = payload.model.slice(0, 160);
        continue;
      }
      if (decoded.data.type !== "event_msg" || payload.type !== "token_count") continue;
      const info = z.object({ last_token_usage: z.unknown() }).passthrough().safeParse(payload.info);
      if (!info.success) continue;
      const tokenUsage = codexTokenSchema.safeParse(info.data.last_token_usage);
      if (!tokenUsage.success) continue;
      const tokens = tokenUsage.data;
      const inputTokens = tokens.input_tokens ?? 0;
      const outputTokens = tokens.output_tokens ?? 0;
      const reasoning = tokens.reasoning_output_tokens ?? 0;
      const cachedInput = tokens.cached_input_tokens ?? tokens.cache_read_input_tokens ?? 0;
      const cacheRead = tokens.cache_read_input_tokens ?? cachedInput;
      const cacheWrite = tokens.cache_write_input_tokens ?? 0;
      if (inputTokens + outputTokens + reasoning + cachedInput + cacheWrite === 0) continue;
      const tokenTimestamp = decoded.data.timestamp ? Date.parse(decoded.data.timestamp) : fileStat.mtimeMs;
      insertLocalTokenEvent(input.db, {
        sourceId: `codex:${input.account.id}:${sourceKey}:${entry.lineIndex}`,
        account: input.account,
        hostId: input.hostId,
        source: "codex-local",
        model,
        occurredAt: Number.isFinite(tokenTimestamp) ? tokenTimestamp : fileStat.mtimeMs,
        inputTokens,
        cachedInputTokens: cachedInput,
        cacheReadInputTokens: cacheRead,
        cacheWriteInputTokens: cacheWrite,
        outputTokens,
        reasoningOutputTokens: reasoning,
        totalTokens: tokens.total_tokens ?? inputTokens + outputTokens + reasoning,
      });
    }
    input.db.prepare(`INSERT INTO usage_source_cursor(source_key, account_id, source, byte_offset, line_index, state_json, last_scanned_at)
      VALUES (?, ?, 'codex-cli', ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        byte_offset = excluded.byte_offset,
        line_index = excluded.line_index,
        state_json = excluded.state_json,
        last_scanned_at = excluded.last_scanned_at`).run(
      sourceKey,
      input.account.id,
      byteOffset,
      lineIndex,
      JSON.stringify({ model }),
      Date.now(),
    );
  });
  applyLines();
  return byteOffset >= fileStat.size;
};

const scanCodexHistory = async (input: { db: UsageDatabase; account: SourceAccount; hostId: string }) => {
  const root = join(input.account.path, "sessions");
  const files = await codexFiles(root);
  const candidates = await Promise.all(files.map(async (filePath) => {
    const fileStat = await stat(filePath);
    const sourceKey = hashSourceKey(input.account.id, "codex-cli", filePath, fileStat.ino);
    const cursor = input.db.prepare("SELECT last_scanned_at FROM usage_source_cursor WHERE source_key = ?").get(sourceKey) as { last_scanned_at: number } | undefined;
    return { filePath, lastScannedAt: cursor?.last_scanned_at ?? 0 };
  }));
  candidates.sort((left, right) => left.lastScannedAt - right.lastScannedAt || left.filePath.localeCompare(right.filePath));
  let incomplete = files.length >= MAX_FILES_PER_SCAN || candidates.length > MAX_CODEX_FILES_PER_TICK;
  let failedFiles = 0;
  for (const { filePath } of candidates.slice(0, MAX_CODEX_FILES_PER_TICK)) {
    try {
      if (!await scanCodexFile({ ...input, filePath })) incomplete = true;
    } catch {
      failedFiles += 1;
      continue;
    }
  }
  storeUsageSourceState(input.db, {
    accountId: input.account.id,
    source: "codex-local",
    status: failedFiles > 0 || incomplete ? "partial" : files.length > 0 ? "ready" : "no-data",
    message: failedFiles > 0 ? `${failedFiles} local history file(s) could not be read.` : incomplete ? "A bounded history scan is still catching up." : files.length > 0 ? null : "No Codex session history was found for this profile.",
    scannedAt: Date.now(),
  });
};

const opencodeDbFiles = async (root: string) => {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^opencode.*\.db$/iu.test(entry.name))
    .map((entry) => join(root, entry.name))
    .slice(0, MAX_FILES_PER_SCAN);
};

const scanOpenCodeDatabase = async (input: {
  db: UsageDatabase;
  account: SourceAccount;
  hostId: string;
  filePath: string;
}) => {
  const fileStat = await stat(input.filePath);
  const sourceKey = hashSourceKey(input.account.id, "opencode-db", input.filePath, fileStat.ino);
  const cursor = input.db.prepare("SELECT watermark, tie_id FROM usage_source_cursor WHERE source_key = ?")
    .get(sourceKey) as { watermark: number; tie_id: string } | undefined;
  const watermark = cursor?.watermark ?? 0;
  const tieId = cursor?.tie_id ?? "";
  const historyDb = new Database(input.filePath, { readonly: true, fileMustExist: true });
  try {
    const tableNames = new Set((historyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((table) => table.name));
    if (!tableNames.has("message") || !tableNames.has("session")) return "unsupported" as const;
    const messageColumns = new Set((historyDb.prepare("PRAGMA table_info(message)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!["id", "session_id", "time_created", "time_updated", "data"].every((column) => messageColumns.has(column))) return "unsupported" as const;
    const rows = historyDb.prepare(`SELECT id, time_created, time_updated, data
      FROM message
      WHERE time_updated > ? OR (time_updated = ? AND id > ?)
      ORDER BY time_updated ASC, id ASC LIMIT ?`).all(
      watermark,
      watermark,
      tieId,
      MAX_OPEN_CODE_ROWS_PER_SCAN,
    ) as Array<{ id: string; time_created: number; time_updated: number; data: string }>;
    let nextWatermark = watermark;
    let nextTieId = tieId;
    const applyRows = input.db.transaction(() => {
      for (const row of rows) {
        nextWatermark = row.time_updated;
        nextTieId = row.id;
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(row.data);
        } catch {
          continue;
        }
        const parsed = opencodeMessageSchema.safeParse(parsedJson);
        const completedAt = parsed.success ? parsed.data.time?.completed ?? parsed.data.metadata?.time?.completed : undefined;
        const tokens = parsed.success ? parsed.data.tokens ?? parsed.data.metadata?.assistant?.tokens : undefined;
        if (!parsed.success || parsed.data.role !== "assistant" || !tokens || typeof completedAt !== "number" || !Number.isFinite(completedAt)) continue;
        const inputTokens = tokens.input ?? 0;
        const outputTokens = tokens.output ?? 0;
        const reasoning = tokens.reasoning ?? 0;
        const cacheRead = tokens.cache?.read ?? 0;
        const cacheWrite = tokens.cache?.write ?? 0;
        if (inputTokens + outputTokens + reasoning + cacheRead + cacheWrite === 0) continue;
        insertLocalTokenEvent(input.db, {
          sourceId: `opencode:${input.account.id}:${row.id}`,
          account: input.account,
          hostId: input.hostId,
          source: "opencode-local",
          model: (parsed.data.modelID ?? parsed.data.metadata?.assistant?.modelID)?.slice(0, 160) ?? null,
          occurredAt: parsed.data.time?.created ?? parsed.data.metadata?.time?.created ?? row.time_created,
          inputTokens,
          cachedInputTokens: cacheRead,
          cacheReadInputTokens: cacheRead,
          cacheWriteInputTokens: cacheWrite,
          outputTokens,
          reasoningOutputTokens: reasoning,
          totalTokens: inputTokens + outputTokens + reasoning + cacheRead + cacheWrite,
        });
      }
      input.db.prepare(`INSERT INTO usage_source_cursor(source_key, account_id, source, watermark, tie_id, last_scanned_at)
        VALUES (?, ?, 'opencode-db', ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET watermark = excluded.watermark, tie_id = excluded.tie_id,
          last_scanned_at = excluded.last_scanned_at`).run(
        sourceKey,
        input.account.id,
        nextWatermark,
        nextTieId,
        Date.now(),
      );
    });
    applyRows();
    return rows.length >= MAX_OPEN_CODE_ROWS_PER_SCAN ? "partial" as const : "ready" as const;
  } finally {
    historyDb.close();
  }
};

const scanOpenCodeHistory = async (input: { db: UsageDatabase; account: SourceAccount; hostId: string }) => {
  const root = join(input.account.path, "opencode");
  const files = await opencodeDbFiles(root);
  let supported = false;
  let incomplete = false;
  for (const filePath of files) {
    try {
      const status = await scanOpenCodeDatabase({ ...input, filePath });
      supported ||= status !== "unsupported";
      incomplete ||= status === "partial";
    } catch {
      continue;
    }
  }
  storeUsageSourceState(input.db, {
    accountId: input.account.id,
    source: "opencode-local",
    status: incomplete ? "partial" : supported ? "ready" : files.length === 0 ? "no-data" : "unsupported",
    message: incomplete ? "A bounded history scan is still catching up." : supported ? null : files.length === 0
      ? "No OpenCode session database was found for this profile."
      : "The OpenCode history database format could not be read safely.",
    scannedAt: Date.now(),
  });
};

export const scanLocalUsageHistory = async (input: {
  db: UsageDatabase;
  accounts: SourceAccount[];
  hostId: string | null;
}) => {
  if (!input.hostId) return;
  for (const account of input.accounts) {
    if (account.provider === "codex") await scanCodexHistory({ db: input.db, account, hostId: input.hostId });
    else await scanOpenCodeHistory({ db: input.db, account, hostId: input.hostId });
  }
};
