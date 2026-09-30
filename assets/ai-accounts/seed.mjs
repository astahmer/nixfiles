import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const accounts = readJson(process.env.AI_ACCOUNTS_CONFIG);
const secrets = readJson(process.env.AI_ACCOUNTS_SECRETS);
const existing = JSON.parse(execFileSync("bb", ["ai-accounts", "list", "--json"], { encoding: "utf8" }));
const existingById = new Map(existing.map((account) => [account.id, account]));
const profileDirectory = join(homedir(), ".local", "share", "bb-ai-accounts");
const ensurePrivateDirectory = (path) => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
};
const writePrivateFile = (path, content) => {
  ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
};
const readSecret = ({ alias, scope }) => {
  const config = scope === "global" ? process.env.GLOBAL_SECRET_CONFIG : process.env.PROJECT_SECRET_CONFIG;
  const session = process.env.BW_SESSION || readStoredSession();
  const result = spawnSync(process.env.SECRET_BIN, ["get", "--config", config, alias], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"],
    env: session ? { ...process.env, BW_SESSION: session } : process.env,
  });
  return result.status === 0 && !result.error ? result.stdout.replace(/[\r\n]+$/u, "") : "";
};
const readStoredSession = () => {
  if (!existsSync("/usr/bin/security")) return "";
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", "bitwarden-session", "-s", "secret-cli", "-w"], {
    encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && !result.error ? result.stdout.replace(/[\r\n]+$/u, "") : "";
};

for (const entry of secrets) {
  const value = readSecret(entry);
  if (!value) {
    process.stderr.write(`bb-ai-accounts: secret alias unavailable: ${entry.alias}\n`);
    continue;
  }
  const authPath = entry.provider === "opencode-go"
    ? join(existingById.get(entry.id)?.path ?? entry.path, "opencode", "auth.json")
    : join(existingById.get(entry.id)?.path ?? entry.path, "auth.json");
  let document;
  if (entry.provider === "opencode-go") {
    let existingAuth = {};
    if (existsSync(authPath)) {
      try {
        const parsed = JSON.parse(readFileSync(authPath, "utf8"));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) existingAuth = parsed;
      } catch {
        process.stderr.write(`bb-ai-accounts: could not parse OpenCode auth file for ${entry.id}\n`);
        continue;
      }
    }
    document = { ...existingAuth, "opencode-go": { type: "api", key: value } };
  } else {
    try {
      document = JSON.parse(value);
    } catch {
      process.stderr.write(`bb-ai-accounts: Codex auth alias must contain auth.json JSON: ${entry.alias}\n`);
      continue;
    }
  }
  writePrivateFile(authPath, `${JSON.stringify(document, null, 2)}\n`);
}

for (const account of accounts.accounts) {
  if (account.provider !== "codex") continue;
  mkdirSync(account.path, { recursive: true, mode: 0o700 });
  for (const override of account.pathOverrides ?? []) mkdirSync(override.path, { recursive: true, mode: 0o700 });
}

ensurePrivateDirectory(profileDirectory);
const configuredIds = new Set(accounts.accounts.map((account) => account.id));
const mergedAccounts = [
  ...accounts.accounts.map((account) => ({
    ...account,
    ...existingById.get(account.id),
    id: account.id,
    provider: account.provider,
    displayName: account.displayName,
    path: account.path,
    badge: account.badge,
    accentColor: account.accentColor,
    providerIcon: account.providerIcon,
    modelReasoningDefaults: account.modelReasoningDefaults,
    enabled: account.enabled,
  })),
  ...existing.filter((account) => !configuredIds.has(account.id)),
];
const mergedPath = join(profileDirectory, `accounts-${randomUUID()}.json`);
writePrivateFile(mergedPath, `${JSON.stringify({ accounts: mergedAccounts })}\n`);
try {
  execFileSync("bb", ["ai-accounts", "sync", mergedPath], { stdio: "ignore" });
} finally {
  rmSync(mergedPath, { force: true });
}
process.stdout.write(`bb-ai-accounts: synchronized ${accounts.accounts.length} account profiles.\n`);
