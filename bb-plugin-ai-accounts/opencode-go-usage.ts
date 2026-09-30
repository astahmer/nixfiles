import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const authFileSchema = z.object({
  "opencode-go": z.object({ type: z.literal("api"), key: z.string().min(1) }).optional(),
  opencode: z.object({ type: z.literal("api"), key: z.string().min(1) }).optional(),
}).passthrough();
const usageWindowSchema = z.object({
  status: z.enum(["ok", "rate-limited"]),
  percent: z.number().finite().min(0).max(100),
  resetsAt: z.string().datetime().optional(),
}).passthrough();
const usageResponseSchema = z.object({
  usage: z.object({
    rolling: usageWindowSchema.optional(),
    weekly: usageWindowSchema.optional(),
    monthly: usageWindowSchema.optional(),
  }),
}).passthrough();
const failure = (message: string) => ({
  supported: true,
  usage: { status: "error" as const, accountEmail: null, planLabel: null, message },
});

export const readOpenCodeGoUsage = async (accountHome?: string) => {
  const dataHome = accountHome ?? process.env.XDG_DATA_HOME;
  if (!dataHome) return failure("The OpenCode account data directory was not provided to the usage reader.");
  try {
    const authContent = await readFile(join(dataHome, "opencode", "auth.json"), "utf8");
    const decodedAuth = authFileSchema.safeParse(JSON.parse(authContent));
    const apiKey = decodedAuth.success
      ? decodedAuth.data["opencode-go"]?.key ?? decodedAuth.data.opencode?.key
      : undefined;
    if (!apiKey) return { supported: true, usage: { status: "unauthenticated" as const } };
    const response = await fetch("https://opencode.ai/zen/go/v1/usage", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return failure("OpenCode Go did not return subscription usage.");
    if (!response.body) return failure("OpenCode Go returned an empty usage response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let responseBytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      responseBytes += chunk.value.byteLength;
      if (responseBytes > 32_768) {
        await reader.cancel();
        return failure("OpenCode Go returned an oversized usage response.");
      }
      chunks.push(chunk.value);
    }
    const rawUsage = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const decodedUsage = usageResponseSchema.safeParse(JSON.parse(rawUsage));
    if (!decodedUsage.success) return failure("OpenCode Go returned an unsupported usage response.");
    const usage = decodedUsage.data.usage;
    const windows = [
      usage.rolling ? { label: "Current session", usedPercent: usage.rolling.percent, resetsAt: usage.rolling.resetsAt ?? null } : null,
      usage.weekly ? { label: "Weekly limit", usedPercent: usage.weekly.percent, resetsAt: usage.weekly.resetsAt ?? null } : null,
      usage.monthly ? { label: "Monthly limit", usedPercent: usage.monthly.percent, resetsAt: usage.monthly.resetsAt ?? null } : null,
    ].filter((window) => window !== null);
    if (windows.length === 0) return failure("OpenCode Go did not return any active usage windows.");
    return {
      supported: true,
      usage: { status: "ok" as const, accountEmail: null, planLabel: "OpenCode Go", windows },
    };
  } catch {
    return failure("OpenCode Go subscription usage could not be read.");
  }
};
