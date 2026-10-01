import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const resetCreditsUrl = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const authSchema = z.object({
  tokens: z.object({ access_token: z.string().min(1), account_id: z.string().min(1).optional(), id_token: z.string().optional() }).passthrough(),
}).passthrough();
const resetCreditsSchema = z.object({
  available_count: z.number().int().nonnegative().optional(),
  credits: z.array(z.object({ status: z.string().optional(), expires_at: z.string().optional() }).passthrough()).optional(),
}).passthrough();

const accountIdFromToken = (token: string | undefined) => {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const claims = z.object({ "https://api.openai.com/auth": z.object({ chatgpt_account_id: z.string().min(1).optional() }).passthrough().optional() }).passthrough().safeParse(decoded);
    return claims.success ? claims.data["https://api.openai.com/auth"]?.chatgpt_account_id ?? null : null;
  } catch {
    return null;
  }
};

export const parseCodexResetCredits = (value: unknown) => {
  const parsed = resetCreditsSchema.safeParse(value);
  if (!parsed.success) return null;
  const availableCredits = (parsed.data.credits ?? []).filter((credit) => credit.status === "available");
  const balance = parsed.data.available_count ?? availableCredits.length;
  const expiresAt = availableCredits.map((credit) => credit.expires_at)
    .filter((value): value is string => value !== undefined && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
  return { balance, expiresAt };
};

const readBoundedResponse = async (response: Response) => {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > 32_000) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export const fetchCodexResetCredits = async (codexHome: string, fetcher: typeof fetch = fetch) => {
  try {
    const authPath = join(codexHome, "auth.json");
    const details = await stat(authPath);
    if (!details.isFile() || details.size > 128_000) return null;
    const rawAuth: unknown = JSON.parse(await readFile(authPath, "utf8"));
    const auth = authSchema.safeParse(rawAuth);
    if (!auth.success) return null;
    const accessToken = auth.data.tokens.access_token;
    const accountId = auth.data.tokens.account_id ?? accountIdFromToken(auth.data.tokens.id_token);
    if (!accountId) return null;
    const response = await fetcher(resetCreditsUrl, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        "openai-beta": "codex-1",
        originator: "Codex Desktop",
        accept: "application/json",
        "user-agent": "Codex Desktop",
      },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 32_000) return null;
    const responseText = await readBoundedResponse(response);
    if (!responseText) return null;
    return parseCodexResetCredits(JSON.parse(responseText));
  } catch {
    return null;
  }
};
