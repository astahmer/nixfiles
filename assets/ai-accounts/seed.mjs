#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const configPath = process.env.AI_ACCOUNTS_CONFIG;
const secretBinary = process.env.SECRET_BIN;
const globalSecretConfig = process.env.GLOBAL_SECRET_CONFIG;
const projectSecretConfig = process.env.PROJECT_SECRET_CONFIG;
const bbBinary = process.env.BB_BIN || "bb";
if (!configPath) throw new Error("AI_ACCOUNTS_CONFIG is required.");

const document = JSON.parse(readFileSync(configPath, "utf8"));
const accountDocument = { accounts: document.accounts };
const unavailableAliases = [];
let writtenCredentialFiles = 0;

const readSecret = (alias, scope) => {
  const config = scope === "global" ? globalSecretConfig : projectSecretConfig;
  if (!secretBinary || !config) return undefined;
  const result = spawnSync(secretBinary, ["get", "--config", config, alias], {
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || result.error) return undefined;
  const value = result.stdout.replace(/[\r\n]+$/u, "");
  return value.length > 0 ? value : undefined;
};

const writePrivateFile = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(contents))) return false;
  const temporaryPath = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return true;
};

for (const entry of document.secrets ?? []) {
  const account = document.accounts.find((profile) => profile.id === entry.accountId);
  if (!account) continue;
  const value = readSecret(entry.alias, entry.scope);
  if (!value) {
    unavailableAliases.push(entry.alias);
    continue;
  }
  const authPath = account.provider === "codex"
    ? account.path + "/auth.json"
    : account.path + "/opencode/auth.json";
  mkdirSync(account.path, { recursive: true, mode: 0o700 });
  chmodSync(account.path, 0o700);
  let contents = value;
  if (entry.format === "opencode-go-key") {
    let existing = {};
    try {
      existing = JSON.parse(readFileSync(authPath, "utf8"));
    } catch {
      existing = {};
    }
    contents = JSON.stringify({
      ...existing,
      "opencode-go": { type: "api", key: value },
    }, null, 2) + "\n";
  } else {
    JSON.parse(value);
    contents = value.endsWith("\n") ? value : value + "\n";
  }
  if (writePrivateFile(authPath, contents)) writtenCredentialFiles += 1;
}

const pluginSync = spawnSync(bbBinary, ["ai-accounts", "sync", configPath], {
  encoding: "utf8",
  timeout: 30000,
  stdio: ["ignore", "pipe", "pipe"],
});
if (pluginSync.status !== 0 || pluginSync.error) {
  throw new Error("Could not synchronize BB AI Accounts. Install the plugin first, then re-apply.");
}

process.stdout.write(JSON.stringify({
  accounts: document.accounts.length,
  writtenCredentialFiles,
  unavailableAliases,
}) + "\n");
