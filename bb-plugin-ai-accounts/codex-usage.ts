import { spawn } from "node:child_process";
import { z } from "zod";

const windowSchema = z.object({
  usedPercent: z.number().finite().min(0).max(100),
  windowDurationMins: z.number().positive().optional(),
  resetsAt: z.union([z.number(), z.string()]).nullable().optional(),
}).passthrough();
const responseSchema = z.object({
  rateLimits: z.object({
    planType: z.string().nullable().optional(),
    primary: windowSchema.nullable().optional(),
    secondary: windowSchema.nullable().optional(),
  }).nullable().optional(),
}).passthrough();
const accountResponseSchema = z.object({
  account: z.object({ email: z.string().email().nullable().optional() }).nullable().optional(),
}).passthrough();
const failure = (message: string) => ({
  supported: true,
  usage: { status: "error" as const, accountEmail: null, planLabel: null, message },
});
const resetDate = (value: number | string | null | undefined) => {
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  if (typeof value === "string") return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
  return null;
};

export const readCodexUsage = async (accountHome?: string) => {
  const codexHome = accountHome ?? process.env.CODEX_HOME;
  if (!codexHome) return failure("The Codex account home was not provided to the usage reader.");
  const child = spawn("codex", ["app-server"], {
    cwd: process.cwd(),
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let outputBuffer = "";
  let settled = false;
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill();
    for (const entry of pending.values()) entry.reject(error ?? new Error("Codex app-server closed."));
    pending.clear();
  };
  const timeout = setTimeout(() => finish(new Error("Codex app-server timed out.")), 5_000);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    outputBuffer += chunk;
    let newlineIndex = outputBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = outputBuffer.slice(0, newlineIndex);
      outputBuffer = outputBuffer.slice(newlineIndex + 1);
      newlineIndex = outputBuffer.indexOf("\n");
      try {
        const message: unknown = JSON.parse(line);
        const decoded = z.object({ id: z.union([z.number(), z.string()]), result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() }).passthrough().safeParse(message);
        if (!decoded.success || typeof decoded.data.id !== "number") continue;
        const request = pending.get(decoded.data.id);
        if (!request) continue;
        pending.delete(decoded.data.id);
        if (decoded.data.error) request.reject(new Error(decoded.data.error.message));
        else request.resolve(decoded.data.result);
      } catch {
        continue;
      }
    }
  });
  child.on("error", () => finish(new Error("Codex app-server could not start.")));
  child.on("exit", () => finish(new Error("Codex app-server exited before returning usage.")));
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const notify = (method: string, params: unknown) => child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  try {
    await request("initialize", {
      clientInfo: { name: "bb_ai_accounts", title: "BB AI Accounts", version: "1" },
      capabilities: { experimentalApi: true },
    });
    notify("initialized", {});
    const [rawLimits, rawAccount] = await Promise.all([
      request("account/rateLimits/read", null),
      request("account/read", {}),
    ]);
    const limits = responseSchema.safeParse(rawLimits);
    const account = accountResponseSchema.safeParse(rawAccount);
    if (!limits.success || !limits.data.rateLimits) return failure("Codex did not return subscription limits for this account.");
    const limitData = limits.data.rateLimits;
    const windows = [
      limitData.primary ? { label: limitData.primary.windowDurationMins && limitData.primary.windowDurationMins < 1_440 ? "Current session" : "Primary limit", usedPercent: limitData.primary.usedPercent, resetsAt: resetDate(limitData.primary.resetsAt) } : null,
      limitData.secondary ? { label: limitData.secondary.windowDurationMins && limitData.secondary.windowDurationMins <= 10_080 ? "Weekly limit" : "Secondary limit", usedPercent: limitData.secondary.usedPercent, resetsAt: resetDate(limitData.secondary.resetsAt) } : null,
    ].filter((window) => window !== null);
    const plan = limitData.planType?.toLowerCase() ?? null;
    const planLabel = plan === "plus" ? "Plus" : plan === "pro" ? "Pro" : plan === "team" || plan === "business" ? "Business" : plan === "free" ? "Free" : limitData.planType ?? null;
    return {
      supported: true,
      usage: {
        status: "ok" as const,
        accountEmail: account.success ? account.data.account?.email ?? null : null,
        planLabel,
        windows,
      },
    };
  } catch {
    return failure("Codex subscription limits could not be read from this account.");
  } finally {
    finish();
  }
};
