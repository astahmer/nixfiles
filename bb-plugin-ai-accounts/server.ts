import { defineCli, cliCommand, PluginCliError, defineRpcContract, type BbPluginApi, type JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { toRemainingPercent, quotaChartBucketMs, usageChartBucketMs, usageMigrations, storeThreadUsageEvents, upsertBankedResets, upsertQuotaPollState, upsertQuotaWindow, readLatestQuotaSnapshots } from "./usage-history.ts";
import { scanLocalUsageHistory } from "./usage-sources.ts";
import { fetchCodexResetCredits } from "./codex-reset-credits.ts";
import { providerIconOptions } from "./provider-icons";

const providerSchema = z.enum(["codex", "opencode-go"]);
const providerIconSchema = z.enum(providerIconOptions);
const accountSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/u),
  provider: providerSchema,
  displayName: z.string().trim().min(1).max(48).refine((name) => !/[\u0000-\u001f\u007f]/u.test(name)),
  badge: z.string().trim().min(1).max(4).transform((value) => value.toUpperCase()).optional(),
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/u).optional(),
  providerIcon: providerIconSchema.optional(),
  path: z.string().min(1).max(1024).refine(
    (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
    "must be an absolute path without control characters",
  ),
  pathOverrides: z.array(z.object({
    projectId: z.string().min(1).nullable(),
    hostId: z.string().min(1).nullable(),
    path: z.string().min(1).max(1024).refine(
      (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
      "must be an absolute path without control characters",
    ),
  })).max(100).default([]),
  email: z.string().email().optional(),
  enabled: z.boolean().default(true),
  hiddenModelIds: z.array(z.string().min(1).max(160)).max(500).default([]),
  favoriteModelIds: z.array(z.string().min(1).max(160)).max(500).default([]),
  modelOrder: z.array(z.string().min(1).max(160)).max(500).default([]),
  modelReasoningDefaults: z.record(z.string().min(1).max(160), z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"])).refine(
    (defaults) => Object.keys(defaults).length <= 500,
    "Model reasoning defaults cannot contain more than 500 entries.",
  ).default({}),
  customModels: z.array(z.object({
    id: z.string().trim().min(1).max(160).refine((id) => !/[\u0000-\u001f\u007f]/u.test(id)),
    displayName: z.string().trim().min(1).max(80).refine((name) => !/[\u0000-\u001f\u007f]/u.test(name)),
  })).max(100).default([]).refine(
    (models) => new Set(models.map((model) => model.id)).size === models.length,
    "Custom model IDs must be unique.",
  ),
});
const stateSchema = z.object({ accounts: z.array(accountSchema).max(100) }).refine(
  (state) => new Set(state.accounts.map((account) => account.id)).size === state.accounts.length,
  "Account profile IDs must be unique.",
);
export type AccountProfile = z.infer<typeof accountSchema>;
type Account = AccountProfile;
type Provider = z.infer<typeof providerSchema>;
type ProviderIcon = z.infer<typeof providerIconSchema>;

const stateKey = "accounts-v2";
const usageSettingsKey = "usage-settings-v1";
const defaultUsageRefreshIntervalMinutes = 5;
const usageRefreshIntervalMinutesSchema = z.number().int().min(1).max(60);
const accountInputSchema = accountSchema.omit({ id: true }).extend({ id: accountSchema.shape.id.optional() });
const accountIdSchema = accountSchema.shape.id;
const usageRangeSchema = z.object({ startAt: z.number().int().nonnegative(), endAt: z.number().int().positive() })
  .refine((range) => range.endAt > range.startAt, "Usage range end must be after its start.")
  .refine((range) => range.endAt - range.startAt <= 366 * 24 * 60 * 60 * 1000, "Usage range cannot exceed one year.");
const usageSummarySchema = z.object({
  capturedAt: z.number(),
  range: usageRangeSchema,
  accounts: z.array(z.object({ id: z.string(), displayName: z.string(), provider: providerSchema, enabled: z.boolean() })),
  hosts: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
  quota: z.array(z.object({ accountId: z.string(), accountName: z.string(), provider: providerSchema, hostId: z.string(), windowKey: z.string(), label: z.string(), usedPercent: z.number(), remainingPercent: z.number(), resetsAt: z.string().nullable(), capturedAt: z.number(), status: z.string(), message: z.string().nullable() })),
  quotaHistory: z.array(z.object({ accountId: z.string(), accountName: z.string(), provider: providerSchema, hostId: z.string(), windowKey: z.string(), label: z.string(), usedPercent: z.number(), remainingPercent: z.number(), resetsAt: z.string().nullable(), capturedAt: z.number() })),
  quotaModelUsage: z.array(z.object({ accountId: z.string(), hostId: z.string(), windowKey: z.string(), intervalStartAt: z.number(), capturedAt: z.number(), model: z.string().nullable(), totalTokens: z.number() })),
  bankedResets: z.array(z.object({ accountId: z.string(), hostId: z.string(), balance: z.number(), expiresAt: z.string().nullable(), resets: z.array(z.object({ expiresAt: z.string().nullable() })), capturedAt: z.number() })),
  tokenTotals: z.object({ totalTokens: z.number(), inputTokens: z.number(), cachedInputTokens: z.number(), cacheReadInputTokens: z.number(), cacheWriteInputTokens: z.number(), outputTokens: z.number(), reasoningOutputTokens: z.number(), activeTokens: z.number() }),
  tokenSeries: z.array(z.object({ bucketAt: z.number(), accountId: z.string(), accountName: z.string(), provider: providerSchema, hostId: z.string(), model: z.string().nullable(), totalTokens: z.number(), activeTokens: z.number(), inputTokens: z.number(), cachedInputTokens: z.number(), cacheReadInputTokens: z.number(), cacheWriteInputTokens: z.number(), outputTokens: z.number(), reasoningOutputTokens: z.number() })),
  tokenBreakdown: z.array(z.object({ accountId: z.string(), accountName: z.string(), provider: providerSchema, hostId: z.string(), threadId: z.string().nullable(), projectId: z.string().nullable(), model: z.string().nullable(), source: z.string(), totalTokens: z.number(), inputTokens: z.number(), cachedInputTokens: z.number(), cacheReadInputTokens: z.number(), cacheWriteInputTokens: z.number(), outputTokens: z.number(), reasoningOutputTokens: z.number() })),
  sources: z.array(z.object({ accountId: z.string(), source: z.string(), status: z.string(), message: z.string().nullable(), lastScannedAt: z.number().nullable() })),
  refreshedAt: z.number().nullable(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;
export const rpcContract = defineRpcContract({
  defaults: {
    input: z.null(),
    output: z.object({ codex: z.string(), opencodeGo: z.string() }),
  },
  machines: {
    input: z.null(),
    output: z.object({ machines: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })) }),
  },
  catalog: {
    input: z.object({ id: accountIdSchema, hostId: z.string().min(1) }),
    output: z.object({ models: z.array(z.object({
      id: z.string(), displayName: z.string(), isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]), description: z.string() })),
      defaultReasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]),
    })) }),
  },
  list: {
    input: z.null(),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  save: {
    input: accountInputSchema,
    output: z.object({ account: accountSchema }),
  },
  remove: {
    input: z.object({ id: accountIdSchema }),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  identity: {
    input: z.object({ id: accountIdSchema, path: accountSchema.shape.path.optional() }),
    output: z.object({ email: z.string().email().nullable() }),
  },
  usageSettings: {
    input: z.null(),
    output: z.object({ refreshIntervalMinutes: usageRefreshIntervalMinutesSchema }),
  },
  setUsageRefreshInterval: {
    input: z.object({ refreshIntervalMinutes: usageRefreshIntervalMinutesSchema }),
    output: z.object({ refreshIntervalMinutes: usageRefreshIntervalMinutesSchema }),
  },
  usageSummary: { input: z.object({ range: usageRangeSchema }), output: usageSummarySchema },
  refreshUsage: { input: z.object({ range: usageRangeSchema }), output: usageSummarySchema },
});

const providerDisplayNames: Record<Provider, string> = {
  codex: "Codex",
  "opencode-go": "OpenCode Go",
};

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const badgeFor = (displayName: string, provider: Provider) => {
  const initials = displayName.split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 3);
  return initials || (provider === "codex" ? "CDX" : "OCG");
};
const colorFor = (id: string, provider: Provider) => {
  const palette = provider === "codex"
    ? ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2"]
    : ["#7C3AED", "#C026D3", "#DB2777", "#EA580C", "#4F46E5", "#0D9488"];
  const index = [...id].reduce((total, character) => total + character.charCodeAt(0), 0) % palette.length;
  return palette[index];
};
const assignProviderIcons = (accounts: Account[]) => {
  const usedIcons = new Set(accounts.flatMap((account) => account.providerIcon ? [account.providerIcon] : []));
  const availableIcons = providerIconOptions.filter((icon) => !usedIcons.has(icon));
  let nextIconIndex = 0;
  return accounts.map((account) => {
    if (account.providerIcon) return account;
    const providerIcon: ProviderIcon = availableIcons[nextIconIndex] ?? providerIconOptions[nextIconIndex % providerIconOptions.length];
    nextIconIndex += 1;
    return { ...account, providerIcon };
  });
};

const runBb = (args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(process.env.BB_CLI ?? "bb", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 }, (error, stdout) => {
    if (error) {
      reject(new Error("BB command failed."));
      return;
    }
    resolve(stdout);
  });
});

const accountPathFor = (account: Account, projectId: string | null, hostId: string) => {
  const matches = account.pathOverrides.filter((override) =>
    (override.projectId === null || override.projectId === projectId) &&
    (override.hostId === null || override.hostId === hostId),
  );
  matches.sort((left, right) =>
    Number(right.projectId !== null) + Number(right.hostId !== null) -
    Number(left.projectId !== null) - Number(left.hostId !== null),
  );
  return matches[0]?.path ?? account.path;
};

const tokenEmail = (auth: unknown) => {
  const result = z.object({ tokens: z.object({ id_token: z.string().optional() }).optional() }).safeParse(auth);
  const token = result.success ? result.data.tokens?.id_token : undefined;
  const payload = token?.split(".")[1];
  if (payload === undefined) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const claims = z.object({ email: z.string().email() }).safeParse(decoded);
    return claims.success ? claims.data.email : null;
  } catch {
    return null;
  }
};

export default async function plugin(bb: BbPluginApi) {
  const readState = async () => {
    const stored = await bb.storage.kv.get<unknown>(stateKey);
    if (stored === undefined) return { accounts: [] };
    const parsed = stateSchema.safeParse(stored);
    if (!parsed.success) throw new Error("Stored account profiles are invalid; edit or remove the affected profiles.");
    return { accounts: assignProviderIcons(parsed.data.accounts) };
  };

  const usageDb = bb.storage.database();
  bb.storage.migrate(usageDb, usageMigrations);
  let lastUsageRefreshAt: number | null = null;
  let usageRefresh: Promise<void> | null = null;
  let usageRefreshIntervalMinutes = defaultUsageRefreshIntervalMinutes;
  let wakeUsageScheduler: (() => void) | null = null;
  const readUsageRefreshInterval = async () => {
    const stored = await bb.storage.kv.get<unknown>(usageSettingsKey);
    if (stored === undefined) return defaultUsageRefreshIntervalMinutes;
    const parsed = z.object({ refreshIntervalMinutes: usageRefreshIntervalMinutesSchema }).safeParse(stored);
    return parsed.success ? parsed.data.refreshIntervalMinutes : defaultUsageRefreshIntervalMinutes;
  };
  const pruneUsageHistory = () => {
    const now = Date.now();
    const previous = usageDb.prepare("SELECT value FROM usage_meta WHERE key = 'retention-pruned-at'").get() as { value: string } | undefined;
    if (previous && now - Number(previous.value) < 24 * 60 * 60 * 1000) return;
    const prune = usageDb.transaction(() => {
      usageDb.prepare("DELETE FROM quota_snapshots WHERE captured_at < ?").run(now - 90 * 24 * 60 * 60 * 1000);
      usageDb.prepare("DELETE FROM token_usage WHERE occurred_at < ?").run(now - 365 * 24 * 60 * 60 * 1000);
      usageDb.prepare("INSERT INTO usage_meta(key, value) VALUES ('retention-pruned-at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now));
    });
    prune();
  };
  const accountIdentity = (account: Account) => ({
    id: account.id,
    name: account.displayName,
    provider: account.provider,
    providerId: `ai-account-${account.id}`,
  });

  const pollAccountUsage = async () => {
    const { accounts } = await readState();
    const hosts = await bb.sdk.hosts.list();
    const connectedHosts = hosts.filter((host) => host.status === "connected");
    for (const account of accounts.filter((profile) => profile.enabled)) {
      for (const host of connectedHosts) {
        const capturedAt = Date.now();
        try {
          const result = await bb.sdk.system.usageLimits({ hostId: host.id, providerId: `ai-account-${account.id}` });
          const usage = result[`ai-account-${account.id}`];
          if (!usage || usage.status !== "ok") {
            upsertQuotaPollState(usageDb, { account: accountIdentity(account), hostId: host.id, status: usage?.status ?? "missing", message: usage?.status === "error" ? usage.message.slice(0, 240) : null, attemptedAt: capturedAt, succeeded: false });
            continue;
          }
          const labels = new Map<string, number>();
          for (const window of usage.windows) {
            const labelKey = window.label.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "window";
            const occurrence = labels.get(labelKey) ?? 0;
            labels.set(labelKey, occurrence + 1);
            const remaining = toRemainingPercent(window.usedPercent);
            if (remaining === null) continue;
            const usedPercent = window.usedPercent;
            const resetsAt = window.resetsAt && Number.isFinite(Date.parse(window.resetsAt)) ? new Date(window.resetsAt).toISOString() : null;
            upsertQuotaWindow(usageDb, { account: accountIdentity(account), hostId: host.id, windowKey: `${labelKey}:${occurrence}`, label: window.label.slice(0, 80), usedPercent, resetsAt, windowDurationMinutes: null, capturedAt });
          }
          upsertQuotaPollState(usageDb, { account: accountIdentity(account), hostId: host.id, status: labels.size ? "ok" : "unavailable", message: labels.size ? null : "The provider returned no valid quota windows.", attemptedAt: capturedAt, succeeded: labels.size > 0 });
        } catch (error) {
          upsertQuotaPollState(usageDb, { account: accountIdentity(account), hostId: host.id, status: "error", message: error instanceof Error ? error.message.slice(0, 240) : "Usage request failed.", attemptedAt: capturedAt, succeeded: false });
        }
      }
    }
    lastUsageRefreshAt = Date.now();
  };

  const readUsageSummary = async (range: z.infer<typeof usageRangeSchema>) => {
    const { accounts } = await readState();
    const hosts = await bb.sdk.hosts.list();
    const now = Date.now();
    const rangeStart = range.startAt;
    const rangeEnd = range.endAt;
    const durationMs = rangeEnd - rangeStart;
    const tokenBucketMs = usageChartBucketMs(durationMs);
    const quotaSeriesCount = (usageDb.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT account_id, host_id, window_key FROM quota_snapshots WHERE captured_at >= ? AND captured_at < ?
    )`).get(rangeStart, rangeEnd) as { count: number }).count;
    const quotaBucketMs = quotaChartBucketMs(durationMs, quotaSeriesCount);
    const quota = readLatestQuotaSnapshots(usageDb).map((entry) => {
      const poll = usageDb.prepare("SELECT status, message FROM quota_poll_state WHERE account_id = ? AND host_id = ?")
        .get(entry.accountId, entry.hostId) as { status: string; message: string | null } | undefined;
      return { ...entry, status: poll?.status ?? "unknown", message: poll?.message ?? null };
    });
    const quotaHistory = usageDb.prepare(`WITH ranked AS (
      SELECT account_id AS accountId, account_name AS accountName, provider, host_id AS hostId, window_key AS windowKey,
        label, used_percent AS usedPercent, resets_at AS resetsAt, captured_at AS capturedAt,
        ROW_NUMBER() OVER (PARTITION BY account_id, host_id, window_key, CAST(captured_at / ? AS INTEGER) ORDER BY captured_at DESC, id DESC) AS rank
      FROM quota_snapshots WHERE captured_at >= ? AND captured_at < ?
    ) SELECT accountId, accountName, provider, hostId, windowKey, label, usedPercent, resetsAt, capturedAt
      FROM ranked WHERE rank = 1 ORDER BY capturedAt LIMIT 5000`).all(quotaBucketMs, rangeStart, rangeEnd) as Array<{ accountId: string; accountName: string; provider: Provider; hostId: string; windowKey: string; label: string; usedPercent: number; resetsAt: string | null; capturedAt: number }>;
    const quotaModelUsage = usageDb.prepare(`WITH sampled AS (
      SELECT account_id AS accountId, host_id AS hostId, window_key AS windowKey, captured_at AS capturedAt,
        ROW_NUMBER() OVER (PARTITION BY account_id, host_id, window_key, CAST(captured_at / ? AS INTEGER) ORDER BY captured_at DESC, id DESC) AS rank
      FROM quota_snapshots WHERE captured_at >= ? AND captured_at < ?
    ), points AS (
      SELECT accountId, hostId, windowKey, capturedAt,
        COALESCE(LAG(capturedAt) OVER (PARTITION BY accountId, hostId, windowKey ORDER BY capturedAt), ?) AS intervalStartAt
      FROM sampled WHERE rank = 1
    ) SELECT points.accountId, points.hostId, points.windowKey, points.intervalStartAt, points.capturedAt,
        token_usage.model AS model, SUM(token_usage.total_tokens) AS totalTokens
      FROM points JOIN token_usage ON token_usage.account_id = points.accountId AND token_usage.host_id = points.hostId
        AND token_usage.occurred_at > points.intervalStartAt AND token_usage.occurred_at <= points.capturedAt
      GROUP BY points.accountId, points.hostId, points.windowKey, points.intervalStartAt, points.capturedAt, token_usage.model
      ORDER BY points.capturedAt DESC, totalTokens DESC LIMIT 10000`).all(quotaBucketMs, rangeStart, rangeEnd, rangeStart) as Array<{ accountId: string; hostId: string; windowKey: string; intervalStartAt: number; capturedAt: number; model: string | null; totalTokens: number }>;
    const bankedResets = usageDb.prepare(`SELECT account_id AS accountId, host_id AS hostId, balance,
      expires_at AS expiresAt, captured_at AS capturedAt FROM quota_banked_resets ORDER BY account_id, host_id`)
      .all() as Array<{ accountId: string; hostId: string; balance: number; expiresAt: string | null; capturedAt: number }>;
    const bankedResetDates = usageDb.prepare(`SELECT account_id AS accountId, host_id AS hostId, expires_at AS expiresAt
      FROM quota_banked_reset_dates ORDER BY account_id, host_id, reset_index`).all() as Array<{ accountId: string; hostId: string; expiresAt: string | null }>;
    const tokenTotals = usageDb.prepare(`SELECT
      COALESCE(SUM(total_tokens), 0) AS totalTokens, COALESCE(SUM(input_tokens), 0) AS inputTokens,
      COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens, COALESCE(SUM(cache_read_input_tokens), 0) AS cacheReadInputTokens,
      COALESCE(SUM(cache_write_input_tokens), 0) AS cacheWriteInputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
      COALESCE(SUM(reasoning_output_tokens), 0) AS reasoningOutputTokens,
      COALESCE(SUM(CASE WHEN status = 'active' THEN total_tokens ELSE 0 END), 0) AS activeTokens
      FROM token_usage WHERE occurred_at >= ? AND occurred_at < ?`).get(rangeStart, rangeEnd) as { totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number; activeTokens: number };
    const tokenSeries = usageDb.prepare(`SELECT CAST(occurred_at / ? AS INTEGER) * ? AS bucketAt,
      account_id AS accountId, account_name AS accountName, provider, host_id AS hostId, model, SUM(total_tokens) AS totalTokens,
      SUM(input_tokens) AS inputTokens, SUM(cached_input_tokens) AS cachedInputTokens,
      SUM(cache_read_input_tokens) AS cacheReadInputTokens, SUM(cache_write_input_tokens) AS cacheWriteInputTokens,
      SUM(output_tokens) AS outputTokens, SUM(reasoning_output_tokens) AS reasoningOutputTokens,
      SUM(CASE WHEN status = 'active' THEN total_tokens ELSE 0 END) AS activeTokens
      FROM token_usage WHERE occurred_at >= ? AND occurred_at < ? GROUP BY bucketAt, account_id, host_id, model ORDER BY bucketAt LIMIT 5000`).all(tokenBucketMs, tokenBucketMs, rangeStart, rangeEnd) as Array<{ bucketAt: number; accountId: string; accountName: string; provider: Provider; hostId: string; model: string | null; totalTokens: number; activeTokens: number; inputTokens: number; cachedInputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number }>;
    const tokenBreakdown = usageDb.prepare(`SELECT account_id AS accountId, account_name AS accountName, provider, host_id AS hostId,
      thread_id AS threadId, project_id AS projectId, model, source,
      SUM(total_tokens) AS totalTokens, SUM(input_tokens) AS inputTokens, SUM(cached_input_tokens) AS cachedInputTokens,
      SUM(cache_read_input_tokens) AS cacheReadInputTokens, SUM(cache_write_input_tokens) AS cacheWriteInputTokens,
      SUM(output_tokens) AS outputTokens, SUM(reasoning_output_tokens) AS reasoningOutputTokens
      FROM token_usage WHERE occurred_at >= ? AND occurred_at < ? GROUP BY account_id, host_id, thread_id, project_id, model, source ORDER BY totalTokens DESC LIMIT 1000`).all(rangeStart, rangeEnd) as Array<{ accountId: string; accountName: string; provider: Provider; hostId: string; threadId: string | null; projectId: string | null; model: string | null; source: string; totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number }>;
    const sources = usageDb.prepare("SELECT account_id AS accountId, source, status, message, last_scanned_at AS lastScannedAt FROM usage_source_state ORDER BY account_id, source").all() as Array<{ accountId: string; source: string; status: string; message: string | null; lastScannedAt: number | null }>;
    return usageSummarySchema.parse({
      capturedAt: now,
      range,
      accounts: accounts.map(({ id, displayName, provider, enabled }) => ({ id, displayName, provider, enabled })),
      hosts: hosts.map(({ id, name, status }) => ({ id, name, status })),
      quota: quota.map((entry) => ({ ...entry, remainingPercent: toRemainingPercent(entry.usedPercent) ?? 0 })),
      quotaHistory: quotaHistory.map((entry) => ({ ...entry, remainingPercent: toRemainingPercent(entry.usedPercent) ?? 0 })),
      quotaModelUsage,
      bankedResets: bankedResets.map((entry) => ({ ...entry, resets: bankedResetDates.filter((reset) => reset.accountId === entry.accountId && reset.hostId === entry.hostId).map(({ expiresAt }) => ({ expiresAt })) })),
      tokenTotals,
      tokenSeries,
      tokenBreakdown,
      sources,
      refreshedAt: lastUsageRefreshAt,
    });
  };

  let primaryHostId: string | null = null;
  const environmentHosts = new Map<string, string>();
  const resolvingThreads = new Set<string>();
  type UsageThreadResponse = Pick<Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number], "id" | "providerId" | "environmentId" | "projectId">;
  const syncThreadUsage = async (thread: UsageThreadResponse) => {
    if (!thread.providerId.startsWith("ai-account-") || resolvingThreads.has(thread.id)) return;
    const accountId = thread.providerId.slice("ai-account-".length);
    const { accounts } = await readState();
    const account = accounts.find((profile) => profile.id === accountId);
    if (!account) return;
    resolvingThreads.add(thread.id);
    try {
      let hostId = thread.environmentId ? environmentHosts.get(thread.environmentId) : undefined;
      if (thread.environmentId && !hostId) {
        try {
          hostId = (await bb.sdk.environments.get({ environmentId: thread.environmentId })).hostId;
          environmentHosts.set(thread.environmentId, hostId);
        } catch {
          hostId = primaryHostId ?? "unknown";
        }
      }
      const resolvedHostId = hostId ?? primaryHostId ?? "unknown";
      const cursor = usageDb.prepare("SELECT last_seq FROM thread_usage_cursor WHERE thread_id = ?").get(thread.id) as { last_seq: number } | undefined;
      let afterSeq = cursor?.last_seq ?? 0;
      while (true) {
        const events = await bb.sdk.threads.events.list({ threadId: thread.id, afterSeq: String(afterSeq), limit: "1000", order: "asc", types: ["thread/tokenUsage/updated", "turn/completed"] });
        if (events.length === 0) break;
        afterSeq = storeThreadUsageEvents({ db: usageDb, thread: { id: thread.id, providerId: thread.providerId, hostId: resolvedHostId, projectId: thread.projectId }, account: accountIdentity(account), events });
        if (events.length < 1000) break;
      }
    } catch (error) {
      bb.log.warn(`Could not synchronize AI account thread usage for ${thread.id}.`);
    } finally {
      resolvingThreads.delete(thread.id);
    }
  };

  const backfillThreadUsage = async (signal: AbortSignal) => {
    for (const archived of [false, true]) {
      let offset = 0;
      while (!signal.aborted) {
        const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 100, offset, signal });
        for (const thread of page) {
          if (thread.providerId.startsWith("ai-account-")) await syncThreadUsage(thread);
        }
        offset += page.length;
        if (page.length < 100) break;
      }
    }
  };

  const refreshUsage = async () => {
    if (usageRefresh) return usageRefresh;
    usageRefresh = (async () => {
      pruneUsageHistory();
      await pollAccountUsage();
      const { accounts } = await readState();
      const hosts = await bb.sdk.hosts.list();
      const connectedHost = hosts.find((host) => host.id === primaryHostId && host.status === "connected");
      if (connectedHost) {
        const localAccounts = accounts.filter((account) => account.enabled).map((account) => ({
          id: account.id,
          displayName: account.displayName,
          provider: account.provider,
          path: accountPathFor(account, null, connectedHost.id),
        }));
        await scanLocalUsageHistory({ db: usageDb, accounts: localAccounts, hostId: connectedHost.id });
        const codexAccounts = accounts.filter((account) => account.enabled && account.provider === "codex");
        for (let index = 0; index < codexAccounts.length; index += 4) {
          await Promise.all(codexAccounts.slice(index, index + 4).map(async (account) => {
            const resets = await fetchCodexResetCredits(accountPathFor(account, null, connectedHost.id));
            if (resets) upsertBankedResets(usageDb, { accountId: account.id, hostId: connectedHost.id, ...resets, capturedAt: Date.now() });
          }));
        }
      }
    })().finally(() => { usageRefresh = null; });
    return usageRefresh;
  };

  bb.events.on("experimental_thread.events", ({ thread }) => { void syncThreadUsage(thread); });
  bb.background.service("ai-accounts-usage", {
    async start(signal) {
      const config = await bb.sdk.system.config();
      primaryHostId = config.primaryHostId;
      usageRefreshIntervalMinutes = await readUsageRefreshInterval();
      try { await refreshUsage(); } catch { bb.log.warn("AI account usage refresh failed."); }
      try { await backfillThreadUsage(signal); } catch { bb.log.warn("AI account usage history scan failed."); }
      while (!signal.aborted) {
        const waitResult = await new Promise<"elapsed" | "rescheduled" | "aborted">((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const finish = (result: "elapsed" | "rescheduled" | "aborted") => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            if (wakeUsageScheduler === reschedule) wakeUsageScheduler = null;
            resolve(result);
          };
          const abort = () => finish("aborted");
          const reschedule = () => finish("rescheduled");
          timer = setTimeout(() => finish("elapsed"), usageRefreshIntervalMinutes * 60 * 1000);
          wakeUsageScheduler = reschedule;
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        if (waitResult === "aborted" || signal.aborted) return;
        if (waitResult === "rescheduled") continue;
        try { await refreshUsage(); } catch { bb.log.warn("AI account usage refresh failed."); }
      }
    },
  });

  const registrations = new Map<string, { dispose(): void }>();
  const environmentContributions = new Set<string>();
  const syncProviders = async () => {
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
    const { accounts } = await readState();
    for (const account of accounts.filter((profile) => profile.enabled)) {
      const accountBadge = account.badge ?? badgeFor(account.displayName, account.provider);
      const displayName = accountBadge + " · " + account.displayName;
      const launchCommand = account.provider === "codex" ? "npx" : "opencode";
      const launchArgs = account.provider === "codex" ? ["--yes", "@agentclientprotocol/codex-acp@2.0.1"] : ["acp"];
      const launch: JsonValue = { displayName, command: launchCommand, args: launchArgs, env: {} };
      const providerId = "ai-account-" + account.id;
      registrations.set(account.id, bb.providers.register({
        id: providerId,
        displayName,
        family: account.provider === "codex" ? "codex" : "opencode-go",
        icon: account.providerIcon ?? "Bot",
        strings: {
          signInHint: account.provider === "codex"
            ? "Select " + displayName + ", then choose ChatGPT sign-in. This profile stores its login under " + account.path + "."
            : "Select " + displayName + ", then run OpenCode auth login to connect your OpenCode Go key. Credentials stay in this OpenCode data directory.",
          expiredHint: "Reauthenticate this account from AI Accounts, then retry the session.",
          installUrl: account.provider === "codex" ? "https://github.com/agentclientprotocol/codex-acp" : "https://opencode.ai/docs/go/",
          brandPrefix: account.provider === "codex" ? "Codex " : "OpenCode ",
          iconTint: { light: account.accentColor ?? colorFor(account.id, account.provider), dark: account.accentColor ?? colorFor(account.id, account.provider) },
        },
        experimental_bridgeOptions: {
          acpLaunchSpec: launch,
          acpDialect: "generic",
          accountId: account.id,
          accountProvider: account.provider,
          accountHome: account.path,
          accountDisplayName: account.displayName,
          accountBadge,
          hiddenModelIds: account.hiddenModelIds,
          favoriteModelIds: account.favoriteModelIds,
          modelOrder: account.modelOrder,
          modelReasoningDefaults: account.modelReasoningDefaults,
          customModels: account.customModels,
        },
        maintenance: { usage: true },
        capabilities: {
          supportsServiceTier: false,
          supportsNativeUserQuestion: true,
          fork: "tip",
          supportsManualCompaction: true,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full", "accept-edits"],
          reasoningLevels: account.provider === "codex"
            ? ["low", "medium", "high", "xhigh", "max", "ultra"]
            : ["low", "medium", "high"],
        },
        composerActions: [],
        models: { scope: "host" },
        env: { passthrough: [account.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME"] },
      }));
      const variable = account.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME";
      if (!environmentContributions.has(providerId)) {
        bb.providers.experimental_contributeEnv(providerId, async (context) => {
          const current = await readState();
          const configured = current.accounts.find((profile) => profile.id === account.id);
          if (configured === undefined || !configured.enabled) return [];
          return [{
            name: variable,
            value: accountPathFor(configured, context.projectId, context.hostId),
            reason: "Use the account path configured for this project and machine in AI Accounts.",
          }];
        });
        environmentContributions.add(providerId);
      }
    }
  };

  await syncProviders();
  bb.rpc.register(rpcContract, {
    defaults() {
      const root = join(homedir(), ".local", "share", "bb-ai-accounts");
      return { codex: join(root, "codex"), opencodeGo: join(root, "opencode") };
    },
    async machines() {
      try {
        const result: unknown = JSON.parse(await runBb(["machine", "list", "--json"]));
        const decoded = z.array(z.object({ id: z.string(), name: z.string(), status: z.string() }).passthrough()).safeParse(result);
        if (!decoded.success) return { machines: [] };
        return { machines: decoded.data.map(({ id, name, status }) => ({ id, name, status })) };
      } catch {
        return { machines: [] };
      }
    },
    async catalog({ id, hostId }) {
      const { accounts } = await readState();
      const account = accounts.find((profile) => profile.id === id);
      if (account === undefined || !account.enabled) return { models: [] };
      const providerId = account.provider === "codex" ? "codex" : "ai-account-" + account.id;
      try {
        const result: unknown = JSON.parse(await runBb(["provider", "models", providerId, "--host", hostId, "--json"]));
        const decoded = z.array(z.object({
          id: z.string(),
          displayName: z.string(),
          isDefault: z.boolean(),
          supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]), description: z.string() })),
          defaultReasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]),
        }).passthrough()).safeParse(result);
        if (!decoded.success) return { models: [] };
        const accountBadge = account.badge ?? badgeFor(account.displayName, account.provider);
        return { models: decoded.data.filter((model) => !model.id.startsWith("codex-perso/")).map(({ id: modelId, displayName, isDefault, supportedReasoningEfforts, defaultReasoningEffort }) => ({
          id: modelId,
          displayName: displayName.endsWith(" · " + accountBadge) ? displayName.slice(0, -accountBadge.length - 3) : displayName,
          isDefault,
          supportedReasoningEfforts,
          defaultReasoningEffort,
        })) };
      } catch {
        return { models: [] };
      }
    },
    async list() {
      const { accounts } = await readState();
      return { accounts };
    },
    async save(input) {
      const normalized = accountInputSchema.parse(input);
      const { accounts } = await readState();
      const id = normalized.id ?? crypto.randomUUID();
      const account: Account = accountSchema.parse({
        ...normalized,
        id,
        badge: normalized.badge ?? badgeFor(normalized.displayName, normalized.provider),
        accentColor: normalized.accentColor ?? colorFor(id, normalized.provider),
      });
      const next = accounts.some((saved) => saved.id === id)
        ? accounts.map((saved) => saved.id === id ? account : saved)
        : [...accounts, account];
      const accountsWithIcons = assignProviderIcons(next);
      await bb.storage.kv.set(stateKey, { accounts: accountsWithIcons });
      await syncProviders();
      return { account: accountsWithIcons.find((saved) => saved.id === id) ?? account };
    },
    async remove({ id }) {
      const { accounts } = await readState();
      const next = accounts.filter((account) => account.id !== id);
      await bb.storage.kv.set(stateKey, { accounts: next });
      await syncProviders();
      return { accounts: next };
    },
    async identity({ id, path }) {
      const { accounts } = await readState();
      const account = accounts.find((profile) => profile.id === id);
      if (account === undefined || account.provider !== "codex") return { email: account?.email ?? null };
      try {
        const authFile = await readFile((path ?? account.path) + "/auth.json", "utf8");
        const email = tokenEmail(JSON.parse(authFile));
        if (email === null) return { email: account.email ?? null };
        const next = accounts.map((profile) => profile.id === id ? { ...profile, email } : profile);
        await bb.storage.kv.set(stateKey, { accounts: next });
        return { email };
      } catch {
        return { email: account.email ?? null };
      }
    },
    async usageSettings() {
      return { refreshIntervalMinutes: await readUsageRefreshInterval() };
    },
    async setUsageRefreshInterval({ refreshIntervalMinutes }) {
      await bb.storage.kv.set(usageSettingsKey, { refreshIntervalMinutes });
      usageRefreshIntervalMinutes = refreshIntervalMinutes;
      wakeUsageScheduler?.();
      return { refreshIntervalMinutes };
    },
    async usageSummary({ range }) {
      return readUsageSummary(range);
    },
    async refreshUsage({ range }) {
      await refreshUsage();
      return readUsageSummary(range);
    },
  });

  bb.cli.register(defineCli({
    name: "ai-accounts",
    summary: "Manage Codex and OpenCode Go accounts for BB",
    commands: {
      list: cliCommand({
        summary: "List registered AI accounts",
        options: { json: { type: "boolean", description: "Emit JSON" } },
        async run(input) {
          const { accounts } = await readState();
          return {
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify(accounts)
              : accounts.length === 0
                ? "No accounts yet. Open AI Accounts in BB to add one."
                : accounts.map((account) => (account.enabled ? "● " : "○ ") + providerDisplayNames[account.provider] + " · " + account.displayName + (account.email ? " (" + account.email + ")" : "") + " — " + account.path).join("\n"),
          };
        },
      }),
      login: cliCommand({
        summary: "Print a sign-in command for an account",
        positionals: [{ name: "id", description: "Account id", required: true }],
        async run(input) {
          const { accounts } = await readState();
          const account = accounts.find((profile) => profile.id === input.positionals.id);
          if (account === undefined) throw new PluginCliError("Account not found.", { code: "account_not_found" });
          const command = account.provider === "codex"
            ? "mkdir -p " + quote(account.path) + " && chmod 700 " + quote(account.path) + " && CODEX_HOME=" + quote(account.path) + " codex login"
            : "mkdir -p " + quote(account.path) + " && XDG_DATA_HOME=" + quote(account.path) + " opencode auth login";
          return { exitCode: 0, stdout: "Run this in a terminal to sign in to " + account.displayName + ":\n\n" + command };
        },
      }),
      remove: cliCommand({
        summary: "Remove a BB account profile without deleting its credentials",
        positionals: [{ name: "id", description: "Account id", required: true }],
        async run(input) {
          const { accounts } = await readState();
          const next = accounts.filter((account) => account.id !== input.positionals.id);
          if (next.length === accounts.length) throw new PluginCliError("Account not found.", { code: "account_not_found" });
          await bb.storage.kv.set(stateKey, { accounts: next });
          await syncProviders();
          return { exitCode: 0, stdout: "Profile removed. Provider credential files were left in place." };
        },
      }),
      sync: cliCommand({
        summary: "Replace account profiles from a declarative JSON file",
        positionals: [{ name: "path", description: "Path to an accounts JSON file", required: true }],
        async run(input) {
          let document: unknown;
          try {
            document = JSON.parse(await readFile(input.positionals.path, "utf8"));
          } catch {
            throw new PluginCliError("Could not read or parse the accounts file.", { code: "invalid_accounts_file" });
          }
          const parsed = stateSchema.safeParse(document);
          if (!parsed.success) throw new PluginCliError("Accounts file must contain a valid accounts array.", { code: "invalid_accounts_file" });
          await bb.storage.kv.set(stateKey, parsed.data);
          await syncProviders();
          return { exitCode: 0, stdout: "Synchronized " + parsed.data.accounts.length + " profiles." };
        },
      }),
    },
  }));
}
