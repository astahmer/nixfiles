import { lstat, readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const usageOptionsSchema = z.object({
  accountId: z.string().min(1),
  accountProvider: z.enum(["codex", "opencode-go"]),
  accountDisplayName: z.string().optional(),
  proxyAccountName: z.string().optional(),
});

const quotaSchema = z
  .object({
    fiveHourPercent: z.number().finite().min(0).max(100).optional(),
    fiveHourResetAt: z.number().finite().positive().optional(),
    shortPercent: z.number().finite().min(0).max(100).optional(),
    shortResetAt: z.number().finite().positive().optional(),
    shortWindowSeconds: z.number().finite().positive().optional(),
    weeklyPercent: z.number().finite().min(0).max(100).optional(),
    weeklyResetAt: z.number().finite().positive().optional(),
    monthlyPercent: z.number().finite().min(0).max(100).optional(),
    monthlyResetAt: z.number().finite().positive().optional(),
    customWindows: z
      .array(
        z
          .object({
            label: z.string().min(1).max(100),
            percent: z.number().finite().min(0).max(100),
            resetAt: z.number().finite().positive().optional(),
          })
          .passthrough(),
      )
      .max(50)
      .optional(),
  })
  .passthrough();
const codexAccountsSchema = z
  .object({
    accounts: z
      .array(
        z
          .object({
            id: z.string(),
            alias: z.string().optional(),
            email: z.string().nullable().optional(),
            plan: z.string().nullable().optional(),
            logLabel: z.string().optional(),
            isMain: z.boolean().optional(),
            needsReauth: z.boolean().optional(),
            quota: quotaSchema.nullable().optional(),
          })
          .passthrough(),
      )
      .max(100),
  })
  .passthrough();
const providerQuotasSchema = z
  .object({
    reports: z
      .array(
        z
          .object({
            provider: z.string(),
            label: z.string().optional(),
            quota: quotaSchema,
          })
          .passthrough(),
      )
      .max(500),
  })
  .passthrough();
const providerNamesSchema = z.array(z.object({ name: z.string() }).passthrough()).max(500);

const percentWindow = (label: string, percent: number | undefined, resetAt: number | undefined) => {
  if (percent === undefined) return null;
  const reset =
    resetAt === undefined
      ? null
      : new Date(resetAt < 1_000_000_000_000 ? resetAt * 1000 : resetAt).toISOString();
  return { label, usedPercent: percent, resetsAt: reset };
};

const quotaWindows = (raw: unknown) => {
  const parsed = quotaSchema.safeParse(raw);
  if (!parsed.success) return [];
  const quota = parsed.data;
  const windows = [
    percentWindow("Session", quota.fiveHourPercent, quota.fiveHourResetAt),
    percentWindow(
      quota.shortWindowSeconds
        ? quota.shortWindowSeconds >= 3600
          ? `Session (${Math.round(quota.shortWindowSeconds / 3600)} hrs)`
          : `Short (${Math.round(quota.shortWindowSeconds / 60)} min)`
        : "Short",
      quota.shortPercent,
      quota.shortResetAt,
    ),
    percentWindow("Weekly", quota.weeklyPercent, quota.weeklyResetAt),
    percentWindow("Monthly", quota.monthlyPercent, quota.monthlyResetAt),
    ...(quota.customWindows ?? []).map((window) =>
      percentWindow(window.label, window.percent, window.resetAt),
    ),
  ];
  return windows.filter((window): window is NonNullable<typeof window> => window !== null);
};

const accountKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "");
const codexPlanLabels: Record<string, string> = {
  free: "ChatGPT Free Subscription",
  go: "ChatGPT Go Subscription",
  plus: "ChatGPT Plus Subscription",
  pro: "ChatGPT Pro 20x Subscription",
  prolite: "ChatGPT Pro 5x Subscription",
  promax: "ChatGPT Pro Max Subscription",
  team: "ChatGPT Team Subscription",
  business: "ChatGPT Business Subscription",
  self_serve_business_prolite: "ChatGPT Business Subscription",
  self_serve_business_usage_based: "ChatGPT Business Subscription",
  ent26: "ChatGPT Enterprise Subscription",
  enterprise: "ChatGPT Enterprise Subscription",
  enterprise_cbp_automation: "ChatGPT Enterprise Subscription",
  enterprise_cbp_usage_based: "ChatGPT Enterprise Subscription",
  edu: "ChatGPT Edu Subscription",
};

const adminTokenPattern = /^ocx_admin_[A-Za-z0-9_-]{43}$/u;
const responseByteLimit = 1_000_000;
const proxyCache = new Map<string, { expiresAt: number; result: Promise<unknown | null> }>();

const readBoundedJson = async (path: string, byteLimit: number): Promise<unknown | null> => {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > byteLimit) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const openCodexDirectory = () => {
  const configured = process.env.OPENCODEX_HOME?.trim();
  if (!configured) return join(homedir(), ".opencodex");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
};

const loadOpenCodexConfig = async () => {
  const raw = await readBoundedJson(join(openCodexDirectory(), "config.json"), 1_000_000);
  const parsed = z
    .object({ port: z.number().int().min(1).max(65535) })
    .passthrough()
    .safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const loadOpenCodexAdminToken = async () => {
  const environmentToken = process.env.OPENCODEX_ADMIN_AUTH_TOKEN?.trim();
  if (environmentToken && adminTokenPattern.test(environmentToken)) return environmentToken;
  const tokenPath = join(openCodexDirectory(), "admin-api-token");
  try {
    const metadata = await lstat(tokenPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 512) return null;
    const token = (await readFile(tokenPath, "utf8")).trim();
    return adminTokenPattern.test(token) ? token : null;
  } catch {
    return null;
  }
};

const openCodexJson = async (path: string) => {
  const cached = proxyCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const result = (async () => {
    const [config, token] = await Promise.all([loadOpenCodexConfig(), loadOpenCodexAdminToken()]);
    if (!config || !token) return null;
    try {
      return await new Promise<unknown | null>((resolveRequest) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: config.port,
            path,
            method: "GET",
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            timeout: 5000,
          },
          (response) => {
            if (response.statusCode !== 200) {
              response.resume();
              resolveRequest(null);
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer | string) => {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytes += buffer.length;
              if (bytes > responseByteLimit) {
                request.destroy();
                resolveRequest(null);
                return;
              }
              chunks.push(buffer);
            });
            response.on("end", () => {
              try {
                resolveRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
              } catch {
                resolveRequest(null);
              }
            });
            response.on("error", () => resolveRequest(null));
          },
        );
        request.on("timeout", () => request.destroy());
        request.on("error", () => resolveRequest(null));
        request.end();
      });
    } catch {
      return null;
    }
  })();
  proxyCache.set(path, { expiresAt: Date.now() + 15_000, result });
  if (proxyCache.size > 8) proxyCache.delete(proxyCache.keys().next().value ?? "");
  return result;
};

export const readOpenCodexAccountUsage = async (raw: unknown) => {
  const options = usageOptionsSchema.safeParse(raw);
  if (!options.success) return { supported: false };
  const requestedName = options.data.proxyAccountName?.trim();
  const names = [
    requestedName,
    options.data.accountId,
    ...(options.data.accountProvider === "codex" && options.data.accountId === "codex"
      ? ["main", "@main"]
      : []),
    options.data.accountDisplayName,
  ].filter((name): name is string => Boolean(name?.trim()));
  if (options.data.accountProvider === "codex") {
    const rawAccounts = await openCodexJson("/api/codex-auth/accounts");
    const decoded = codexAccountsSchema.safeParse(rawAccounts);
    if (!decoded.success)
      return {
        supported: true,
        usage: {
          status: "error",
          message: "OpenCodex is unavailable; check its local management API.",
        },
      };
    const normalizedNames = new Set(names.map(accountKey));
    const account = decoded.data.accounts.find((row) =>
      [row.id, row.alias, row.logLabel, ...(row.isMain ? ["main", "@main"] : [])].some(
        (name) => name !== undefined && normalizedNames.has(accountKey(name)),
      ),
    );
    if (!account) {
      return {
        supported: true,
        usage: {
          accountEmail: null,
          planLabel: null,
          status: "error",
          message:
            "No OpenCodex Codex account matches this profile. Set its account mapping in AI Accounts.",
        },
      };
    }
    if (account.needsReauth) return { supported: true, usage: { status: "expired" } };
    const windows = quotaWindows(account.quota);
    const planLabel = account.plan
      ? (codexPlanLabels[account.plan.toLowerCase()] ?? account.plan)
      : null;
    return {
      supported: true,
      usage: { accountEmail: account.email ?? null, planLabel, status: "ok", windows },
    };
  }
  const rawReports = await openCodexJson("/api/provider-quotas");
  const decoded = providerQuotasSchema.safeParse(rawReports);
  if (!decoded.success)
    return {
      supported: true,
      usage: {
        status: "error",
        message: "OpenCodex is unavailable; check its local management API.",
      },
    };
  const normalizedNames = new Set(names.map(accountKey));
  const report = decoded.data.reports.find((row) => normalizedNames.has(accountKey(row.provider)));
  if (!report) {
    const rawProviders = await openCodexJson("/api/providers");
    const providers = providerNamesSchema.safeParse(rawProviders);
    const isConfigured =
      providers.success &&
      providers.data.some((provider) => normalizedNames.has(accountKey(provider.name)));
    if (isConfigured) {
      return {
        supported: true,
        usage: {
          accountEmail: null,
          planLabel: null,
          status: "error",
          message: "OpenCodex has no current usage report for this provider.",
        },
      };
    }
    return {
      supported: true,
      usage: {
        accountEmail: null,
        planLabel: null,
        status: "error",
        message:
          "No OpenCodex provider matches this profile. Set its account mapping in AI Accounts.",
      },
    };
  }
  return {
    supported: true,
    usage: {
      accountEmail: null,
      planLabel: "OpenCode Go",
      status: "ok",
      windows: quotaWindows(report.quota),
    },
  };
};
