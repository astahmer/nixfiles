#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const userDataDirectory = join(homedir(), ".t3", "userdata");
const settingsPath = join(userDataDirectory, "settings.json");
const secretsDirectory = join(userDataDirectory, "secrets");
const settingsSeedPath = process.env.T3CODE_SETTINGS_SEED_PATH;
const openCodeBinaryPath = process.env.OPENCODE_BIN || "opencode";
const previousOpenCodeBinaryPath = process.env.OPENCODE_V2_BIN;
const secretBinaryPath = process.env.SECRET_BIN;
const projectSecretConfigPath = process.env.PROJECT_SECRET_CONFIG;
const globalSecretConfigPath = process.env.GLOBAL_SECRET_CONFIG;
const obsoleteOpenCodeEnvironmentName = "OPENCODEX_OPENCODE_GO_API_KEY";
const obsoleteOpenCodePlaceholder = "REPLACE-ME";

const settingsSeedDocument = JSON.parse(readFileSync(settingsSeedPath, "utf8"));
const { providerSecrets, ...settingsSeed } = settingsSeedDocument;

const clone = (value) => JSON.parse(JSON.stringify(value));

const providerEnvironmentSecretName = (instanceId, name) =>
  `provider-env-${Buffer.from(instanceId, "utf8").toString("base64url")}-${Buffer.from(name, "utf8").toString("base64url")}`;

const readStoredBitwardenSession = () => {
  if (process.env.BW_SESSION) return process.env.BW_SESSION;
  if (!existsSync("/usr/bin/security")) return undefined;

  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-a", "bitwarden-session", "-s", "secret-cli", "-w"],
    { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }
  );
  if (result.status !== 0 || result.error) return undefined;
  return result.stdout.replace(/[\r\n]+$/u, "") || undefined;
};

const readSecretAlias = (alias, scope, environment) => {
  const configPath = scope === "global" ? globalSecretConfigPath : projectSecretConfigPath;
  if (!secretBinaryPath || !configPath) return undefined;

  const result = spawnSync(secretBinaryPath, ["get", "--config", configPath, alias], {
    encoding: "utf8",
    env: environment,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0 || result.error) return undefined;
  const value = result.stdout.replace(/[\r\n]+$/u, "");
  return value.length > 0 ? value : undefined;
};

const writeProviderSecret = (instanceId, name, value) => {
  mkdirSync(secretsDirectory, { recursive: true });
  chmodSync(secretsDirectory, 0o700);

  const secretPath = join(secretsDirectory, `${providerEnvironmentSecretName(instanceId, name)}.bin`);
  const bytes = Buffer.from(value, "utf8");
  if (existsSync(secretPath) && readFileSync(secretPath).equals(bytes)) return false;

  const temporaryPath = `${secretPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, secretPath);
    chmodSync(secretPath, 0o600);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return true;
};

const readLegacyInlineSecret = (settings, instanceId, environmentName) => {
  const environment = settings.providerInstances?.[instanceId]?.environment ?? [];
  const variable = environment.find((entry) => entry.name === environmentName);
  if (!variable || variable.valueRedacted || typeof variable.value !== "string") return undefined;
  if (variable.value.length === 0 || variable.value === obsoleteOpenCodePlaceholder) return undefined;
  return variable.value;
};

const seedProviderSecrets = (settings) => {
  const storedSession = readStoredBitwardenSession();
  const environment = {
    ...process.env,
    ...(storedSession ? { BW_SESSION: storedSession } : {})
  };
  const unavailableAliases = [];
  let writtenSecrets = 0;

  for (const entry of providerSecrets) {
    const aliasValue = readSecretAlias(entry.alias, entry.scope, environment);
    const legacyValue = readLegacyInlineSecret(settings, entry.instanceId, entry.name) ??
      (entry.instanceId === "opencode-go"
        ? readLegacyInlineSecret(settings, entry.instanceId, obsoleteOpenCodeEnvironmentName)
        : undefined);
    const value = aliasValue ?? legacyValue;
    if (!value) {
      unavailableAliases.push(entry.alias);
      continue;
    }
    if (writeProviderSecret(entry.instanceId, entry.name, value)) writtenSecrets += 1;
  }

  return { unavailableAliases, writtenSecrets };
};

const resolveSeedInstance = (instance) => {
  const resolved = clone(instance);
  if (resolved.config?.binaryPath === "$OPENCODE_BIN") {
    resolved.config.binaryPath = openCodeBinaryPath;
  }
  return resolved;
};

const ensureRedactedOpenCodeEnvironment = (instanceId, instance) => {
  const environment = instance.environment ?? [];
  const preserved = environment.filter((entry) => {
    if (entry.name === "OPENCODE_API_KEY") return false;
    return instanceId !== "opencode-go" || entry.name !== obsoleteOpenCodeEnvironmentName;
  });

  return [
    ...preserved,
    { name: "OPENCODE_API_KEY", value: "", sensitive: true, valueRedacted: true }
  ];
};

const mergeSettings = (settings) => {
  let changed = false;
  const next = { ...settings };

  for (const [key, value] of Object.entries(settingsSeed)) {
    if (key === "providerInstances" || Object.hasOwn(next, key)) continue;
    next[key] = clone(value);
    changed = true;
  }

  const providerInstances = { ...(next.providerInstances ?? {}) };
  for (const [instanceId, seed] of Object.entries(settingsSeed.providerInstances)) {
    const resolvedSeed = resolveSeedInstance(seed);
    const existing = providerInstances[instanceId];
    if (!existing) {
      providerInstances[instanceId] = resolvedSeed;
      changed = true;
      continue;
    }

    let updated = existing;
    if (
      previousOpenCodeBinaryPath &&
      existing.driver === "opencode" &&
      existing.config?.binaryPath === previousOpenCodeBinaryPath
    ) {
      updated = {
        ...updated,
        config: { ...updated.config, binaryPath: openCodeBinaryPath }
      };
    }

    const seededDisplayName = resolvedSeed.displayName;
    const previousDisplayNames = {
      "opencode-go": "OpenCode (OpenCode Go)",
      opencode_mathias: "mathias"
    };
    if (existing.displayName === previousDisplayNames[instanceId] && seededDisplayName) {
      updated = { ...updated, displayName: seededDisplayName };
    }

    if (providerSecrets.some((entry) => entry.instanceId === instanceId)) {
      updated = {
        ...updated,
        environment: ensureRedactedOpenCodeEnvironment(instanceId, updated)
      };
    }

    if (JSON.stringify(updated) !== JSON.stringify(existing)) {
      providerInstances[instanceId] = updated;
      changed = true;
    }
  }

  next.providerInstances = providerInstances;
  return { settings: next, changed };
};

const writeSettings = (original, next) => {
  mkdirSync(userDataDirectory, { recursive: true });
  if (original !== undefined) {
    const backupPath = `${settingsPath}.nix-seed-backup`;
    writeFileSync(backupPath, original, { mode: 0o600 });
    chmodSync(backupPath, 0o600);
  }

  const temporaryPath = `${settingsPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, next, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, settingsPath);
    chmodSync(settingsPath, 0o600);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
};

const main = () => {
  const original = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : undefined;
  let settings = {};
  if (original !== undefined) {
    try {
      settings = JSON.parse(original);
    } catch (error) {
      process.stderr.write(`t3code seed: could not parse ${settingsPath}: ${String(error)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const { unavailableAliases, writtenSecrets } = seedProviderSecrets(settings);
  const merged = mergeSettings(settings);
  const next = `${JSON.stringify(merged.settings, null, 2)}\n`;
  if (merged.changed || original === undefined || next !== original) {
    writeSettings(original, next);
    process.stdout.write("t3code seed: reconciled Nix-managed settings and provider secrets.\n");
  } else {
    process.stdout.write("t3code seed: settings already up to date.\n");
  }

  if (writtenSecrets > 0) {
    process.stdout.write(`t3code seed: refreshed ${writtenSecrets} OpenCode Go credential file(s).\n`);
  }
  if (unavailableAliases.length > 0) {
    process.stderr.write(
      `t3code seed: could not resolve secret aliases: ${unavailableAliases.join(", ")}; existing T3 credential files were preserved.\n`
    );
  }
};

main();
