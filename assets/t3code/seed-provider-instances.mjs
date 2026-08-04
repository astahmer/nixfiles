#!/usr/bin/env node
// Idempotent T3 Code provider-defaults seeder.
//
// Merges default provider instances into ~/.t3/userdata/settings.json without
// touching unrelated settings or clobbering existing instances. Instances the
// seeder owns are tagged with `_nixSeeded` and refreshed only while they still
// carry the seeded binary path (so user edits win).
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SETTINGS_PATH = join(homedir(), ".t3", "userdata", "settings.json");
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const OPENCODEX_API_KEY_PLACEHOLDER = "REPLACE-ME";

const DEFAULT_MODEL_SELECTION = {
  instanceId: "opencode-go",
  model: "deepseek-v4-flash",
  options: [{ id: "variant", value: "max" }]
};

const DEFAULT_PROJECT_MODEL_SELECTION = {
  ...DEFAULT_MODEL_SELECTION,
  options: [{ id: "agent", value: "build" }, { id: "variant", value: "max" }]
};

const DEFAULT_INSTANCES = {
  "opencode-go": {
    driver: "opencode",
    displayName: "OpenCode (OpenCode Go)",
    enabled: true,
    environment: [
      {
        name: "OPENCODEX_OPENCODE_GO_API_KEY",
        value: OPENCODEX_API_KEY_PLACEHOLDER,
        sensitive: false
      }
    ],
    config: {
      enabled: true,
      binaryPath: OPENCODE_BIN,
      serverUrl: "",
      serverPassword: "",
      customModels: [],
      _nixSeeded: true
    }
  }
};

function isSeededDefault(instance) {
  return instance?.config?._nixSeeded === true;
}

function isStillSeedControlled(instance, seeded) {
  if (!instance?.config || !seeded?.config) return false;
  return instance.config.binaryPath === seeded.config.binaryPath;
}

function mergeDefaults(settings) {
  const next = { ...settings };
  const providers = { ...(next.providerInstances ?? {}) };
  const obsoleteSeededBridge =
    providers.opencode &&
    isSeededDefault(providers.opencode) &&
    typeof providers.opencode.config?.binaryPath === "string" &&
    providers.opencode.config.binaryPath.endsWith("/opencode-bridge");

  if (obsoleteSeededBridge) {
    delete providers.opencode;
  }

  for (const [instanceId, seeded] of Object.entries(DEFAULT_INSTANCES)) {
    const existing = providers[instanceId];
    if (!existing) {
      providers[instanceId] = seeded;
      continue;
    }
    if (isSeededDefault(existing) && isStillSeedControlled(existing, seeded)) {
      providers[instanceId] = seeded;
    }
  }

  next.providerInstances = providers;
  return next;
}

function updateProjectDefaults(db) {
  const rows = db.prepare("SELECT project_id, default_model_selection_json FROM projection_projects").all();
  let changed = 0;
  for (const row of rows) {
    let selection;
    try {
      selection = row.default_model_selection_json
        ? JSON.parse(row.default_model_selection_json)
        : null;
    } catch {
      selection = null;
    }
    // Only rewrite selections that still point at the auto-bootstrap Codex
    // default. Explicit user choices are preserved.
    const isCodexDefault =
      selection?.instanceId === "codex" &&
      typeof selection?.model === "string" &&
      !selection.model.includes("/");
    if (!isCodexDefault) continue;
    db.prepare(
      "UPDATE projection_projects SET default_model_selection_json = ?, updated_at = datetime('now') WHERE project_id = ?"
    ).run(JSON.stringify(DEFAULT_PROJECT_MODEL_SELECTION), row.project_id);
    changed += 1;
  }
  return changed;
}

function main() {
  if (!existsSync(SETTINGS_PATH)) {
    process.stdout.write(`t3code seed: ${SETTINGS_PATH} not found; skipping (T3 not started yet).\n`);
    return;
  }

  const original = readFileSync(SETTINGS_PATH, "utf8");
  let settings;
  try {
    settings = JSON.parse(original);
  } catch (error) {
    process.stderr.write(`t3code seed: failed to parse ${SETTINGS_PATH}: ${String(error)}\n`);
    process.exit(1);
  }

  const merged = mergeDefaults(settings);
  const next = `${JSON.stringify(merged, null, 2)}\n`;
  if (next === original) {
    process.stdout.write("t3code seed: provider instances already up to date.\n");
    return;
  }

  const backup = `${SETTINGS_PATH}.nix-seed-backup`;
  writeFileSync(backup, original, { mode: 0o600 });
  mkdirSync(join(homedir(), ".t3", "userdata"), { recursive: true });
  writeFileSync(SETTINGS_PATH, next, { mode: 0o600 });
  chmodSync(SETTINGS_PATH, 0o600);
  process.stdout.write(`t3code seed: merged default provider instances (backup: ${backup}).\n`);
}

function seedProjectDefaults() {
  const stateDb = join(homedir(), ".t3", "userdata", "state.sqlite");
  if (!existsSync(stateDb)) {
    process.stdout.write("t3code seed: state.sqlite not found; skipping project defaults.\n");
    return;
  }
  try {
    // sqlite3 ships with Node 22+; use it so Home Manager needs no extra deps.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(stateDb, { readOnly: false });
    const projectChanges = updateProjectDefaults(db);
    db.close();
    if (projectChanges > 0) {
      process.stdout.write(
        `t3code seed: switched ${projectChanges} project default(s) to OpenCode Go.\n`
      );
    }
  } catch (error) {
    process.stderr.write(`t3code seed: project defaults skipped (${String(error)})\n`);
  }
}

seedProjectDefaults();
main();
