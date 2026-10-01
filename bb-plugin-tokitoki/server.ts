import { execFile } from "node:child_process";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const providerNames = [
  "claude-code",
  "claude",
  "codex",
  "copilot",
  "github-copilot",
  "commandcode",
  "cursor",
  "pi",
  "opencode",
  "opencode-go",
  "openrouter",
  "t3code",
  "antigravity-cli",
] as const;

const accountSchema = z.object({
  provider: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  accountId: z.string().max(160),
  label: z.string().max(160),
  remainingPercent: z.number().min(0).max(100).nullable(),
  metric: z.string().max(48).nullable(),
  detail: z.string().max(160).nullable(),
  capturedAt: z.number().nullable(),
});

const usageSchema = z.object({
  accounts: z.array(accountSchema).max(100),
  capturedAt: z.number().nullable(),
  error: z.string().max(240).nullable(),
});

export const rpcContract = defineRpcContract({
  usage: { input: z.null(), output: usageSchema },
  refresh: { input: z.null(), output: usageSchema },
});

type Usage = z.infer<typeof usageSchema>;
type Account = z.infer<typeof accountSchema>;
type RecordValue = Record<string, unknown>;

const providerSet = new Set<string>(providerNames);
const emptyUsage = (): Usage => ({ accounts: [], capturedAt: null, error: null });

const readString = (value: RecordValue, keys: string[]) => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 160);
  }
  return null;
};

const readNumber = (value: RecordValue, keys: string[]) => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
};

const normalizePercent = (value: number | null) => {
  if (value === null) return null;
  const percent = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
};

const decodePayload = (payload: unknown): Usage => {
  const accounts: Account[] = [];
  const identities = new Set<string>();

  const visit = (
    value: unknown,
    inheritedProvider: string | null,
    inheritedAccount: { id: string; label: string } | null,
    inheritedMetric: string | null,
    depth: number,
  ) => {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inheritedProvider, inheritedAccount, inheritedMetric, depth + 1);
      return;
    }

    const parsed = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsed.success) return;
    const record = parsed.data;
    const providerField = readString(record, ["provider", "providerId", "harness"]);
    const providerKey = Object.keys(record).find((key) => providerSet.has(key));
    const provider = providerField && providerSet.has(providerField)
      ? providerField
      : providerKey ?? inheritedProvider;
    const accountId = readString(record, ["accountKey", "accountId", "account_id", "key"]);
    const accountLabel = readString(record, ["displayName", "accountName", "accountLabel", "label", "email", "name"]);
    const identityId = accountId ?? (accountLabel ? readString(record, ["id", "slug"]) : null);
    const identityLabel = accountLabel ?? (identityId ? readString(record, ["label", "name"]) : null);
    const account = identityId && identityLabel ? { id: identityId, label: identityLabel } : inheritedAccount;
    const metric = readString(record, ["metric", "mode", "window", "windowLabel", "limitName"]) ?? inheritedMetric;
    const remaining = readNumber(record, ["remainingPercent", "remainingPct", "remaining", "quotaRemaining", "remaining_ratio"]);
    const used = readNumber(record, ["usedPercent", "percentUsed", "usagePercent", "usedRatio", "utilization"]);

    if (provider && account && (remaining !== null || used !== null)) {
      const remainingPercent = normalizePercent(remaining ?? (used === null ? null : 100 - (used >= 0 && used <= 1 ? used * 100 : used)));
      const reset = readString(record, ["resetsAt", "resetAt", "resetTime"]);
      const status = readString(record, ["status", "message"]);
      const capturedAt = readNumber(record, ["capturedAt", "updatedAt", "fetchedAt", "timestamp"]);
      const key = `${provider}:${account.id}:${metric ?? ""}`;
      if (!identities.has(key)) {
        identities.add(key);
        accounts.push({
          provider,
          accountId: account.id,
          label: account.label,
          remainingPercent,
          metric,
          detail: reset ?? status,
          capturedAt,
        });
      }
    }

    for (const [key, child] of Object.entries(record)) {
      const childProvider = providerSet.has(key) ? key : provider;
      const childMetric = /five.?hour|session|weekly|seven.?day|monthly|quota|window/iu.test(key) ? key : metric;
      visit(child, childProvider, account, childMetric, depth + 1);
    }
  };

  visit(payload, null, null, null, 0);
  const root = z.record(z.string(), z.unknown()).safeParse(payload);
  const capturedAt = root.success ? readNumber(root.data, ["capturedAt", "updatedAt", "generatedAt"]) : null;
  return usageSchema.parse({ accounts: accounts.slice(0, 100), capturedAt, error: null });
};

const runTokitoki = (binaryPath: string, refresh: boolean): Promise<Usage> => new Promise((resolve) => {
  const args = ["widget-payload", ...(refresh ? ["--skip-scan"] : ["--cached"]), "--json"];
  execFile(binaryPath, args, { encoding: "utf8", timeout: refresh ? 20_000 : 8_000, maxBuffer: 2_000_000 }, (error, stdout) => {
    if (error) {
      resolve({ ...emptyUsage(), error: "Tokitoki did not return a cached usage snapshot." });
      return;
    }
    try {
      resolve(decodePayload(JSON.parse(stdout)));
    } catch {
      resolve({ ...emptyUsage(), error: "Tokitoki returned a payload this plugin could not read." });
    }
  });
});

export default async (bb: BbPluginApi) => {
  const settings = bb.settings.define({
    binaryPath: { type: "string", label: "Tokitoki executable", default: "tokitoki" },
  });
  let cached: { expiresAt: number; value: Usage } | null = null;

  const getUsage = async (refresh = false) => {
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
    const { binaryPath } = await settings.get();
    const value = await runTokitoki(binaryPath, refresh);
    cached = { expiresAt: Date.now() + 15_000, value };
    return value;
  };

  bb.rpc.register(rpcContract, {
    usage: async () => getUsage(),
    refresh: async () => getUsage(true),
  });
};
