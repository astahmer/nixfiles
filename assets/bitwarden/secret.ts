#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import http from "node:http";

type SecretDefinition = {
  item: string;
  field?: string;
  env?: string;
};

type SecretConfig = {
  secrets?: Record<string, SecretDefinition>;
  environments?: Record<string, { secrets?: Record<string, SecretDefinition> }>;
};

type ParsedOptions = {
  command: string;
  positional: string[];
  configPath?: string;
  outputPath?: string;
  envName?: string;
  required?: string[];
  optional?: string[];
  copy?: boolean;
  check?: boolean;
  generate?: boolean;
  force?: boolean;
  export?: boolean;
  json?: boolean;
  all?: boolean;
  diff?: boolean;
  dry?: boolean;
  dryRun?: boolean;
  source?: string;
  global?: boolean;
  store?: boolean;
};

const home = homedir();
const userConfigPath = join(home, ".config", "secret", "config.json");
const historyPath = join(home, ".config", "secret", "history.json");
const sessionPath = process.env.SECRET_SESSION_FILE || join(home, ".config", "secret", "session");
const daemonDir = join(home, ".config", "secret", "daemon");
const daemonStatePath = join(daemonDir, "daemon.json");
const daemonSocketPath = join(daemonDir, "bw.sock");
const DAEMON_HOST = "localhost";
const DAEMON_PORT = 8087;
const daemonEnabled = (): boolean => process.env.SECRET_DAEMON !== "0";
const KEYCHAIN_SERVICE = "secret-cli";
const KEYCHAIN_ACCOUNT = "bitwarden-session";
const projectConfigName = ".secret.json";
const localConfigName = ".secret.local.json";
const placeholderValues = new Set(["replace-me", "REPLACE-ME"]);
const HISTORY_LIMIT = 100;

// Minimal ANSI coloring; no dependency. Colors only apply on a real terminal,
// so pipes and the regression suite get plain text.
const ansi =
  (enabled: boolean) =>
  (code: string) =>
  (text: string): string =>
    enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
const outColor = ansi(Boolean(process.stdout.isTTY));
const errColor = ansi(Boolean(process.stderr.isTTY));
const info = (text: string): void => console.error(errColor("2")(`secret: ${text}`));
const success = (text: string): void => console.error(errColor("32")(`secret: ${text}`));
const warn = (text: string): void => console.error(errColor("33")(`secret: ${text}`));

const commandAliases: Record<string, string> = {
  st: "status",
  ls: "list",
  g: "get",
  s: "set",
  add: "set",
  delete: "rm",
  remove: "rm",
  sync: "pull",
  so: "source",
  pu: "pull",
  e: "env",
  d: "doctor",
  pr: "print",
};

type HistoryEntry = {
  at: string;
  cmd: string;
  target: string;
  env?: string;
};

function fail(message: string, code = 1): never {
  console.error(errColor("31")(`secret: ${message}`));
  process.exit(code);
}

const readJson = (filePath: string): SecretConfig => {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as SecretConfig;
    if (!parsed || typeof parsed !== "object" || !parsed.secrets || typeof parsed.secrets !== "object") {
      fail(`invalid config: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    fail(`cannot read config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const optionalConfig = (filePath: string): SecretConfig => (existsSync(filePath) ? readJson(filePath) : {});

const configPath = (value: string): string => (isAbsolute(value) ? value : resolve(process.cwd(), value));

const findConfigUpward = (name: string): string | undefined => {
  let directory = process.cwd();
  for (;;) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (directory === home || parent === directory) return undefined;
    directory = parent;
  }
};

const findProjectConfig = (): string | undefined => findConfigUpward(projectConfigName);

const findProjectLocalConfig = (): string | undefined => findConfigUpward(localConfigName);

const configContainsAlias = (config: SecretConfig, alias: string): boolean =>
  config.secrets?.[alias] !== undefined ||
  Object.values(config.environments || {}).some((environment) => environment.secrets?.[alias] !== undefined);

const configWithAlias = (
  alias: string,
  projectPath?: string,
  localPath?: string,
): { filePath: string; config: SecretConfig } | undefined => {
  for (const filePath of [localPath, projectPath].filter((path): path is string => path !== undefined)) {
    const config = readJson(filePath);
    if (configContainsAlias(config, alias)) return { filePath, config };
  }
  if (existsSync(userConfigPath)) {
    const config = readJson(userConfigPath);
    if (configContainsAlias(config, alias)) return { filePath: userConfigPath, config };
  }
  return undefined;
};

const parseOptions = (argv: string[]): ParsedOptions => {
  const positional: string[] = [];
  let selectedConfig: string | undefined;
  let outputPath: string | undefined;
  let selectedEnv: string | undefined;
  const required: string[] = [];
  const optional: string[] = [];
  let copy = false;
  let check = false;
  let generate = false;
  let force = false;
  let exportOutput = false;
  let json = false;
  let all = false;
  let diff = false;
  let dry = false;
  let dryRun = false;
  let source: string | undefined;
  let global = false;
  let store = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === "--config") {
      selectedConfig = argv[++index] || fail("--config requires a file path");
    } else if (argument === "--output") {
      outputPath = argv[++index] || fail("--output requires a file path");
    } else if (argument === "--env") {
      const value = argv[++index] || fail("--env requires a name");
      if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(`invalid environment name: ${value}`);
      selectedEnv = value;
    } else if (argument === "--required") {
      const value = argv[++index] || fail("--required needs alias names");
      required.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    } else if (argument === "--optional") {
      const value = argv[++index] || fail("--optional needs alias names");
      optional.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    } else if (argument === "--copy") {
      copy = true;
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--generate") {
      generate = true;
    } else if (argument === "--force" || argument === "-f") {
      force = true;
    } else if (argument === "--global" || argument === "-g") {
      global = true;
    } else if (argument === "--export") {
      exportOutput = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--all") {
      all = true;
    } else if (argument === "--diff") {
      diff = true;
    } else if (argument === "--dry") {
      dry = true;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--source") {
      source = argv[++index] || fail("--source requires a URL");
    } else if (argument === "--store") {
      store = true;
    } else if (argument === "-h" || argument === "--help") {
      positional.push(argument);
    } else if (argument === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    } else if (argument.startsWith("--")) {
      fail(`unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  return {
    command: positional.shift() || "help",
    positional,
    configPath: selectedConfig ? configPath(selectedConfig) : undefined,
    outputPath: outputPath ? configPath(outputPath) : undefined,
    envName: selectedEnv,
    required,
    optional,
    copy,
    check,
    generate,
    force,
    export: exportOutput,
    json,
    all,
    diff,
    dry,
    dryRun,
    source,
    global,
    store,
  };
};

const loadDefinitions = (selectedConfig?: string, environment = "prod"): {
  definitions: Record<string, SecretDefinition>;
  selectedAliases?: string[];
} => {
  const user = optionalConfig(userConfigPath);
  const projectPath = selectedConfig || findProjectConfig();
  const project = projectPath ? readJson(projectPath) : {};
  const localPath = findProjectLocalConfig();
  const projectLocal = localPath ? readJson(localPath) : {};
  const definitions = {
    ...(user.secrets || {}),
    ...(project.secrets || {}),
    ...(projectLocal.secrets || {}),
  };

  if (environment !== "prod") {
    const sources = [user, project, projectLocal];
    if (!sources.some((source) => source.environments?.[environment])) {
      const available = ["prod", ...new Set(sources.flatMap((source) => Object.keys(source.environments || {})))];
      fail(`unknown environment: ${environment} (available: ${available.join(", ")})`);
    }
    for (const source of sources) {
      Object.assign(definitions, source.environments?.[environment]?.secrets || {});
    }
  }

  for (const [alias, definition] of Object.entries(definitions)) {
    if (!definition || typeof definition.item !== "string" || !definition.item) {
      fail(`invalid definition for ${alias}`);
    }
  }

  const projectAliases = projectPath ? Object.keys(project.secrets || {}) : [];
  if (projectPath && environment !== "prod") {
    projectAliases.push(...Object.keys(project.environments?.[environment]?.secrets || {}));
  }
  const localAliases = localPath ? Object.keys(projectLocal.secrets || {}) : [];
  if (localPath && environment !== "prod") {
    localAliases.push(...Object.keys(projectLocal.environments?.[environment]?.secrets || {}));
  }

  return {
    definitions,
    selectedAliases: projectPath || localPath ? [...new Set([...projectAliases, ...localAliases])] : undefined,
  };
};

// bw's stderr names the real failure; never swallow it into a generic
// "request failed" message.
const bwError = (result: { stderr?: string | null; stdout?: string }): string =>
  (result.stderr || "").trim().slice(0, 300) ||
  (result.stdout || "").trim().slice(0, 300) ||
  "no output";

const runBw = (arguments_: string[]): string => {
  const result = spawnSync("bw", arguments_, { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail(`Bitwarden CLI request failed: ${bwError(result)}`);
  return result.stdout.trim();
};

const runBwInput = (arguments_: string[], input: string): string => {
  const result = spawnSync("bw", arguments_, { encoding: "utf8", input });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail(`Bitwarden CLI request failed: ${bwError(result)}`);
  return result.stdout.trim();
};

// A stale BW_SESSION in the env corrupts bw's protected auto-unlock key
// (bw warns about this itself), so unlock must run with a clean environment.
const withoutStaleSession = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.BW_SESSION;
  return env;
};

// Unlock needs the real terminal: the master-password prompt is unusable when
// stdin is a pipe. stderr stays inherited (the prompt), stdout is captured.
const runBwUnlock = (): string => {
  const result = spawnSync("bw", ["unlock", "--raw"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    env: withoutStaleSession(),
  });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail(`Bitwarden unlock failed: ${bwError(result)}`);
  return result.stdout.trim();
};

const tryGetItemRaw = (item: string): string | undefined => {
  const result = spawnSync("bw", ["get", "item", item, "--raw"], { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  return result.status === 0 ? result.stdout.trim() : undefined;
};

const formatCreatedAt = (iso: string): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const itemCreationDate = (items: Record<string, any>[] | undefined, item: string): string =>
  formatCreatedAt(String(itemFor(items, item)?.creationDate ?? ""));

const status = (): { authenticated: boolean; unlocked: boolean } => {
  const result = spawnSync("bw", ["status"], { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail("Bitwarden status request failed");
  try {
    const data = JSON.parse(result.stdout) as { status?: string };
    return {
      authenticated: data.status !== "unauthenticated",
      unlocked: data.status === "unlocked",
    };
  } catch {
    fail("Bitwarden returned invalid status data");
  }
};

const requireUnlocked = async (): Promise<void> => {
  const current = await currentAuthState();
  if (!current.authenticated) fail("Bitwarden is not authenticated; run bw login first");
  if (!current.unlocked) fail("Bitwarden is locked; run bw unlock --raw and export BW_SESSION");
};

const itemField = (item: Record<string, any>, field: string): unknown => {
  if (field === "password") return item.login?.password;
  if (field === "username") return item.login?.username;
  if (field === "notes") return item.notes;
  const customName = field.startsWith("custom:") ? field.slice("custom:".length) : field;
  return Array.isArray(item.fields)
    ? item.fields.find((entry: { name?: string }) => entry.name === customName)?.value
    : undefined;
};

const getValue = async (alias: string, definition: SecretDefinition): Promise<string> => {
  const items = await vaultItems();
  return resolveRequired(items, alias, definition);
};

// One `bw list items` call per command instead of one `bw get item` per
// alias: every bw spawn costs 1-2s+ of Node startup (more with a live
// session), so batching is what keeps multi-alias commands fast.
const spawnVaultItems = (): Record<string, any>[] | undefined => {
  const result = spawnSync("bw", ["list", "items"], { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, any>[]) : undefined;
  } catch {
    return undefined;
  }
};

const vaultItems = async (): Promise<Record<string, any>[] | undefined> => {
  if (!daemonEnabled()) return spawnVaultItems();
  const viaDaemon = await daemonListItems();
  if (viaDaemon?.kind === "ok") {
    if (viaDaemon.items.length > 0) return viaDaemon.items;
    // An empty list from the daemon is suspicious (bw serve can start with an
    // unpopulated vault cache); cross-check once with a spawn before trusting it.
    const spawned = spawnVaultItems();
    if (spawned && spawned.length > 0) return spawned;
    return viaDaemon.items;
  }
  if (viaDaemon?.kind === "denied") {
    // The daemon lost its unlocked state; when we hold a session it is stale,
    // so restart it once and retry before falling back to spawn hints.
    if (process.env.BW_SESSION) {
      daemonStop();
      if (await daemonStart()) {
        const retry = await daemonListItems();
        if (retry?.kind === "ok") return retry.items;
      }
    }
    return undefined;
  }
  if (await ensureDaemon()) {
    const retry = await daemonListItems();
    if (retry?.kind === "ok") return retry.items;
    if (retry?.kind === "denied") return undefined;
  }
  return spawnVaultItems();
};

const itemFor = (items: Record<string, any>[] | undefined, item: string): Record<string, any> | undefined =>
  items?.find((entry) => entry.id === item || entry.name === item);

const valueFor = (item: Record<string, any> | undefined, definition: SecretDefinition): string | undefined => {
  if (item === undefined) return undefined;
  const value = itemField(item, definition.field || "password");
  return typeof value === "string" && value && !placeholderValues.has(value) ? value : undefined;
};

const resolveRequired = async (
  items: Record<string, any>[] | undefined,
  alias: string,
  definition: SecretDefinition,
): Promise<string> => {
  if (items === undefined) {
    await requireUnlocked();
    fail(`could not read vault items (bw list items failed)`);
  }
  const item = itemFor(items, definition.item);
  if (item === undefined) {
    if (items.length === 0) {
      warn("hint: the vault is empty — create items with 'secret set <alias>', or check the account/server in bw config");
    }
    fail(`item not found for ${alias}: ${definition.item}`);
  }
  const value = valueFor(item, definition);
  if (value === undefined) fail(`missing or invalid value for ${alias}`);
  return value;
};

const resolveOptional = (items: Record<string, any>[] | undefined, definition: SecretDefinition): string | undefined =>
  valueFor(itemFor(items, definition.item), definition);

const dotenvKey = (alias: string, definition: SecretDefinition): string => {
  const key = definition.env || alias;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) fail(`invalid dotenv key for ${alias}`);
  return key;
};

const dotenvValue = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const writeAtomic = (filePath: string, contents: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
};

// Persistent `bw serve` daemon over a unix socket (mode 0600 state file, 0700
// directory). Reads are local HTTP calls instead of 1-2s+ Node CLI spawns;
// the daemon is restarted after any mutation so it never serves stale items.
type DaemonState = {
  pid: number;
  socket: string;
};

const readDaemonState = (): DaemonState | undefined => {
  if (!existsSync(daemonStatePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(daemonStatePath, "utf8")) as DaemonState;
    return typeof parsed.pid === "number" && typeof parsed.socket === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeDaemonState = (state: DaemonState): void => {
  try {
    mkdirSync(daemonDir, { recursive: true, mode: 0o700 });
    writeAtomic(daemonStatePath, JSON.stringify(state));
  } catch {
    // The daemon still runs; the next command retries the state write.
  }
};

const daemonRequest = (
  socket: string,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string } | undefined> =>
  new Promise((resolve) => {
    const req = http.request(
      {
        socketPath: socket,
        method,
        path,
        headers: {
          Host: `${DAEMON_HOST}:${DAEMON_PORT}`,
          ...(body !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.setTimeout(5000, () => req.destroy());
    req.on("error", () => resolve(undefined));
    if (body !== undefined) req.write(body);
    req.end();
  });

const parseDaemon = (
  res: { status: number; body: string } | undefined,
): { kind: "ok"; data: unknown } | { kind: "denied" } | undefined => {
  if (res === undefined) return undefined;
  try {
    const parsed = JSON.parse(res.body) as { success?: boolean; data?: unknown };
    if (parsed.success && res.status === 200) return { kind: "ok", data: parsed.data };
    if (parsed.success === false) return { kind: "denied" };
    return undefined;
  } catch {
    return undefined;
  }
};

const daemonStatus = async (): Promise<string | undefined> => {
  const state = readDaemonState();
  if (!state) return undefined;
  const parsed = parseDaemon(await daemonRequest(state.socket, "GET", "/status"));
  if (parsed?.kind !== "ok") return undefined;
  // bw serve wraps responses: { success, data: { object, template: { status } } }.
  const data = parsed.data as { template?: { status?: unknown }; status?: unknown };
  const status = data.template?.status ?? data.status;
  return typeof status === "string" ? status : undefined;
};

const daemonListItems = async (): Promise<
  { kind: "ok"; items: Record<string, any>[] } | { kind: "denied" } | undefined
> => {
  const state = readDaemonState();
  if (!state) return undefined;
  const parsed = parseDaemon(await daemonRequest(state.socket, "GET", "/list/object/items"));
  if (parsed?.kind === "denied") return { kind: "denied" };
  if (parsed?.kind !== "ok") return undefined;
  // Real serve returns { success, data: { object: "list", data: [...] } }.
  const data = parsed.data as { data?: unknown };
  const items = Array.isArray(parsed.data) ? parsed.data : data.data;
  return Array.isArray(items) ? { kind: "ok", items: items as Record<string, any>[] } : undefined;
};

// Run a mutation through the daemon when it is up; true means the daemon
// handled it (and stays warm). False means fall back to a bw spawn.
const daemonMutate = async (
  method: string,
  path: string,
  payload?: Record<string, any>,
): Promise<boolean> => {
  if (!daemonEnabled()) return false;
  const state = readDaemonState();
  if (!state) return false;
  const res = await daemonRequest(
    state.socket,
    method,
    path,
    payload === undefined ? undefined : JSON.stringify(payload),
  );
  const parsed = parseDaemon(res);
  if (parsed?.kind === "ok") return true;
  if (parsed?.kind === "denied") fail("Bitwarden is locked; run bw unlock --raw and export BW_SESSION");
  daemonStop();
  return false;
};

const generatePassword = async (): Promise<string> => {
  if (daemonEnabled()) {
    const state = readDaemonState();
    if (state) {
      const res = await daemonRequest(
        state.socket,
        "GET",
        "/generate?length=32&uppercase=true&lowercase=true&number=true&special=true",
      );
      const parsed = parseDaemon(res);
      if (parsed?.kind === "ok") {
        const data = parsed.data as { data?: unknown };
        if (typeof data.data === "string" && data.data) return data.data;
      }
      if (parsed?.kind === "denied") fail("Bitwarden is locked; run bw unlock --raw and export BW_SESSION");
      daemonStop();
    }
  }
  return runBw(["generate", "-ulns", "--length", "32"]);
};

const daemonStop = (): void => {
  const state = readDaemonState();
  if (!state) return;
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // already dead
  }
  try {
    unlinkSync(state.socket);
  } catch {
    // already gone
  }
  try {
    unlinkSync(daemonStatePath);
  } catch {
    // already gone
  }
};

const daemonStart = async (): Promise<boolean> => {
  try {
    mkdirSync(daemonDir, { recursive: true, mode: 0o700 });
  } catch {
    return false;
  }
  try {
    unlinkSync(daemonSocketPath);
  } catch {
    // fresh socket
  }
  const child = spawn(
    "bw",
    ["serve", "--hostname", `unix://${daemonSocketPath}`, "--port", String(DAEMON_PORT)],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  // bw serve slows down (App Nap / idle wake) when untouched; a tiny detached
  // keepalive pings /status every 10s and exits when the daemon dies.
  const keepalive = `
const fs = require("node:fs");
const http = require("node:http");
const socket = process.argv[1];
let seen = false;
let failures = 0;
const ping = () => {
  if (seen && !fs.existsSync(socket)) process.exit(0);
  if (fs.existsSync(socket)) seen = true;
  const req = http.request({ socketPath: socket, path: "/status", headers: { Host: "localhost:8087" } }, (res) => { res.resume(); failures = 0; });
  req.on("error", () => { failures += 1; if (failures >= 3) process.exit(0); });
  req.setTimeout(2000, () => req.destroy());
  req.end();
};
setInterval(ping, 10000);
`;
  spawn("bun", ["-e", keepalive, daemonSocketPath], { detached: true, stdio: "ignore" }).unref();
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (exited) return false;
    const res = await daemonRequest(daemonSocketPath, "GET", "/status");
    if (res && res.status === 200) {
      // Never keep a daemon that reports a locked/unauthenticated vault: it
      // would answer auth questions with a stale state for every later command.
      const parsed = parseDaemon(res);
      let status: unknown;
      if (parsed?.kind === "ok") {
        const data = parsed.data as { template?: { status?: unknown }; status?: unknown };
        status = data.template?.status ?? data.status;
      }
      if (parsed?.kind !== "ok" || status !== "unlocked") {
        try {
          if (child.pid !== undefined) process.kill(child.pid, "SIGKILL");
        } catch {
          // already gone
        }
        return false;
      }
      if (child.pid !== undefined) writeDaemonState({ pid: child.pid, socket: daemonSocketPath });
      // bw serve can start with an empty vault cache; sync once so item reads
      // see the real vault (best-effort: a stale session makes this fail).
      await daemonRequest(daemonSocketPath, "POST", "/sync");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    if (child.pid !== undefined) process.kill(child.pid, "SIGKILL");
  } catch {
    // already gone
  }
  return false;
};

const ensureDaemon = async (): Promise<boolean> => {
  const state = readDaemonState();
  if (state) {
    const res = await daemonRequest(state.socket, "GET", "/status");
    if (res && res.status === 200) return true;
    daemonStop();
  }
  return daemonStart();
};

const currentAuthState = async (): Promise<{ authenticated: boolean; unlocked: boolean }> => {
  if (daemonEnabled()) {
    if (await ensureDaemon()) {
      const daemon = await daemonStatus();
      if (daemon === "unlocked") return { authenticated: true, unlocked: true };
      // A locked/unauthenticated daemon is stale or the vault is genuinely
      // locked; never trust it — the spawn path reports the real state.
      daemonStop();
    }
  }
  return status();
};

const readSession = (): string | undefined => {
  if (process.platform === "darwin") {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8" },
    );
    if (!result.error && result.status === 0 && result.stdout) return result.stdout.trim();
  }
  return existsSync(sessionPath) ? readFileSync(sessionPath, "utf8").trim() : undefined;
};

const storeSession = (token: string): void => {
  if (!token) fail("refusing to store an empty session token");
  if (process.platform === "darwin") {
    const result = spawnSync(
      "security",
      ["add-generic-password", "-U", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w", token],
      { encoding: "utf8" },
    );
    if (!result.error && result.status === 0) return;
    warn("macOS keychain unavailable — falling back to a plaintext session file");
  }
  writeAtomic(sessionPath, token);
};

const clearSession = (): void => {
  if (process.platform === "darwin") {
    spawnSync("security", ["delete-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE], {
      encoding: "utf8",
    });
  }
  if (existsSync(sessionPath)) unlinkSync(sessionPath);
};

const readHistory = (): HistoryEntry[] => {
  if (!existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
};

const recordHistory = (entry: HistoryEntry): void => {
  const entries = readHistory();
  entries.push(entry);
  writeAtomic(historyPath, `${JSON.stringify(entries.slice(-HISTORY_LIMIT), null, 2)}\n`);
};

const printRecent = (json: boolean): void => {
  const byAlias = new Map<string, { last: string; count: number }>();
  for (const entry of readHistory()) {
    if (entry.cmd !== "get" && entry.cmd !== "set") continue;
    const current = byAlias.get(entry.target);
    if (current) {
      current.count += 1;
      if (entry.at > current.last) current.last = entry.at;
    } else {
      byAlias.set(entry.target, { last: entry.at, count: 1 });
    }
  }
  const rows = [...byAlias.entries()].sort((a, b) => (a[1].last < b[1].last ? 1 : -1)).slice(0, 10);
  if (!rows.length) {
    console.error("secret recent: no aliases used yet — try secret get <alias> or secret set <alias>");
    return;
  }
  if (json) {
    console.log(JSON.stringify(rows.map(([alias, info]) => ({ alias, last: info.last, count: info.count }))));
  } else {
    for (const [alias, info] of rows) console.log(`${alias}\t${info.last}\t${info.count}`);
  }
  console.error(`secret recent: ${rows.length} aliases, most recent first`);
};

const printHistory = (json: boolean): void => {
  const entries = readHistory().slice(-20);
  if (!entries.length) {
    console.error("secret history: empty — run a secret command first");
    return;
  }
  if (json) {
    console.log(JSON.stringify(entries));
  } else {
    for (const entry of entries) {
      console.log(`${entry.at}\t${entry.cmd}\t${entry.target}\t${entry.env || ""}`);
    }
  }
  console.error(`secret history: last ${entries.length} commands (${readHistory().length} total)`);
};

const initProjectConfig = (force: boolean, aliases: string[]): void => {
  const filePath = join(process.cwd(), projectConfigName);
  if (existsSync(filePath) && !force) {
    fail(`.secret.json already exists (use --force to overwrite): ${filePath}`);
  }
  const prefix = basename(process.cwd());
  const secrets: Record<string, SecretDefinition> = {};
  for (const alias of aliases) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
      fail(`invalid alias name: ${alias} (letters, digits, underscore, hyphen; must not start with a digit)`);
    }
    secrets[alias] = { item: `${prefix}/${alias.toLowerCase().replaceAll("_", "-")}`, field: "password" };
  }
  if (!aliases.length) {
    secrets.EXAMPLE = { item: `${prefix}/example`, field: "password" };
  }
  const template = {
    secrets,
  };
  writeAtomic(filePath, `${JSON.stringify(template, null, 2)}\n`);
  console.error(
    aliases.length
      ? `secret: created ${filePath} with ${aliases.length} alias(es); then run 'secret env --output .env'`
      : `secret: created ${filePath}; replace EXAMPLE, then run 'secret env --output .env'`,
  );
};

type PrintRow = { alias: string; scope: string; env: string; item: string; field: string; envKey: string };

const configRows = (config: SecretConfig, scope: string): PrintRow[] => {
  const rows: PrintRow[] = [];
  const addDefinitions = (definitions: Record<string, SecretDefinition> | undefined, envName: string): void => {
    for (const [alias, definition] of Object.entries(definitions || {})) {
      if (!definition || typeof definition.item !== "string" || !definition.item) {
        fail(`invalid definition for ${alias}`);
      }
      rows.push({ alias, scope, env: envName, item: definition.item, field: definition.field || "password", envKey: dotenvKey(alias, definition) });
    }
  };
  addDefinitions(config.secrets, "prod");
  for (const [envName, environment] of Object.entries(config.environments || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    addDefinitions(environment.secrets, envName);
  }
  return rows;
};

const scopeRows = (scope: string, filePath: string | undefined): PrintRow[] =>
  filePath && existsSync(filePath) ? configRows(readJson(filePath), scope) : [];

const SCOPE_ORDER: Record<string, number> = { project: 0, global: 1, local: 2 };

const sortRows = (rows: PrintRow[]): void => {
  rows.sort((a, b) =>
    a.alias === b.alias
      ? SCOPE_ORDER[a.scope]! - SCOPE_ORDER[b.scope]! || (a.env < b.env ? -1 : 1)
      : a.alias < b.alias
        ? -1
        : 1,
  );
};

const emitRows = (rows: PrintRow[], json: boolean, includeScope: boolean): void => {
  if (json) {
    console.log(JSON.stringify(includeScope ? rows : rows.map(({ scope: _scope, ...rest }) => rest)));
  } else if (includeScope) {
    for (const row of rows) console.log([row.alias, row.scope, row.env, row.item, row.field, row.envKey].join("\t"));
  } else {
    for (const row of rows) console.log([row.alias, row.env, row.item, row.field, row.envKey].join("\t"));
  }
};

const printConfig = (scope: string, filePath: string, json: boolean): void => {
  if (!existsSync(filePath)) fail(`no config file for ${scope} scope: ${filePath}`);
  const rows = configRows(readJson(filePath), scope);
  sortRows(rows);
  emitRows(rows, json, false);
  console.error(`secret print: ${rows.length} aliases in ${scope} scope (${filePath}). next: secret get <alias>, or secret env --output .env`);
};

const mergedRows = (selectedConfig?: string): PrintRow[] => {
  const projectPath = selectedConfig || findProjectConfig();
  const rows = [
    ...scopeRows("project", projectPath),
    ...scopeRows("global", userConfigPath),
    ...scopeRows("local", findProjectLocalConfig()),
  ];
  sortRows(rows);
  return rows;
};

const printAllScopes = (selectedConfig: string | undefined, json: boolean): void => {
  const rows = mergedRows(selectedConfig);
  emitRows(rows, json, true);
  console.error(`secret print: ${rows.length} aliases across project, global, and local scopes. next: secret get <alias>, or secret env --output .env`);
};

const searchAliases = (query: string, selectedConfig: string | undefined, json: boolean): void => {
  const needle = query.toLowerCase();
  const rows = mergedRows(selectedConfig).filter(
    (row) =>
      row.alias.toLowerCase().includes(needle) ||
      row.item.toLowerCase().includes(needle) ||
      row.envKey.toLowerCase().includes(needle),
  );
  if (!rows.length) {
    console.error(`secret search: no matches for '${query}'. next: try another term, or 'secret print --all'`);
    process.exit(1);
  }
  emitRows(rows, json, true);
  console.error(`secret search: ${rows.length} match(es) for '${query}'. next: secret get <alias>`);
};

type LintProblem = { scope: string; alias: string; message: string };

const lint = (selectedConfig: string | undefined, json: boolean): void => {
  const projectPath = selectedConfig || findProjectConfig();
  const sources = [
    { scope: "project", filePath: projectPath },
    { scope: "global", filePath: userConfigPath },
    { scope: "local", filePath: findProjectLocalConfig() },
  ];
  const problems: LintProblem[] = [];
  const envKeys = new Map<string, { scope: string; alias: string }>();
  let count = 0;

  for (const source of sources) {
    if (!source.filePath || !existsSync(source.filePath)) continue;
    const config = readJson(source.filePath);
    const addDefinitions = (definitions: Record<string, SecretDefinition> | undefined, envName: string): void => {
      for (const [alias, definition] of Object.entries(definitions || {})) {
        count += 1;
        if (!definition || typeof definition.item !== "string" || !definition.item) {
          problems.push({ scope: source.scope, alias, message: "invalid definition (missing item)" });
          continue;
        }
        if (envName !== "prod" && !/^[A-Za-z0-9_-]+$/.test(envName)) {
          problems.push({ scope: source.scope, alias, message: `invalid environment name: ${envName}` });
        }
        const envKey = definition.env || alias;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
          problems.push({ scope: source.scope, alias, message: 'invalid dotenv key (add an explicit "env" field)' });
          continue;
        }
        const previous = envKeys.get(envKey);
        if (previous && previous.alias !== alias) {
          problems.push({
            scope: source.scope,
            alias,
            message: `dotenv key ${envKey} collides with ${previous.scope}:${previous.alias} (last wins silently)`,
          });
        } else {
          envKeys.set(envKey, { scope: source.scope, alias });
        }
      }
    };
    addDefinitions(config.secrets, "prod");
    for (const [envName, environment] of Object.entries(config.environments || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      addDefinitions(environment.secrets, envName);
    }
  }

  if (json) {
    console.log(JSON.stringify(problems));
  } else {
    for (const problem of problems) {
      console.log(`${problem.scope}\t${problem.alias}\t${problem.message}`);
    }
  }
  if (problems.length) {
    console.error(`secret lint: ${problems.length} problem(s) across ${count} alias(es). next: fix the config, or run 'secret doctor' for vault checks`);
    process.exit(1);
  }
  console.error(`secret lint: clean — ${count} alias(es) across project, global, and local. next: secret doctor, or secret env --output .env`);
};

const printScope = (scope: string, selectedConfig?: string, json = false): void => {
  if (scope === "project") {
    const projectPath = selectedConfig || findProjectConfig();
    if (!projectPath) {
      fail(`no ${projectConfigName} found (searched up to $HOME) — run 'secret init' to scaffold one, or pass --config FILE`);
    }
    printConfig("project", projectPath, json);
  } else if (scope === "global") {
    printConfig("global", userConfigPath, json);
  } else if (scope === "local") {
    const localPath = findProjectLocalConfig();
    if (!localPath) {
      fail(`no ${localConfigName} found (searched up to $HOME) — create one for machine-local overrides`);
    }
    printConfig("local", localPath, json);
  } else {
    fail(`unknown scope: ${scope} (available: project, global, local)`);
  }
};

const unsetAlias = (alias: string, selectedConfig?: string, quiet = false): void => {
  const holder = configWithAlias(alias, selectedConfig || findProjectConfig(), findProjectLocalConfig());
  if (!holder) {
    fail(`alias ${alias} is not in a project, local, or user config (see 'secret print --all')`);
  }
  const updated = JSON.parse(JSON.stringify(holder.config)) as SecretConfig;
  delete updated.secrets?.[alias];
  for (const environment of Object.values(updated.environments || {})) delete environment.secrets?.[alias];
  writeAtomic(holder.filePath, `${JSON.stringify(updated, null, 2)}\n`);
  if (!quiet) success(`removed ${alias} from ${holder.filePath}`);
};

const aliasNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const moveAlias = (from: string, to: string, selectedConfig?: string): void => {
  if (!aliasNamePattern.test(to)) {
    fail(`invalid alias name: ${to} (letters, digits, underscore, hyphen; must not start with a digit)`);
  }
  if (from === to) fail(`alias is already named ${to}`);
  const holder = configWithAlias(from, selectedConfig || findProjectConfig(), findProjectLocalConfig());
  if (!holder) {
    fail(`alias ${from} is not in a project, local, or user config (see 'secret print --all')`);
  }
  if (configContainsAlias(holder.config, to)) fail(`alias ${to} already exists in ${holder.filePath}`);
  const updated = JSON.parse(JSON.stringify(holder.config)) as SecretConfig;
  const rename = (definitions: Record<string, SecretDefinition> | undefined): void => {
    if (definitions?.[from]) {
      definitions[to] = definitions[from];
      delete definitions[from];
    }
  };
  rename(updated.secrets);
  for (const environment of Object.values(updated.environments || {})) rename(environment.secrets);
  writeAtomic(holder.filePath, `${JSON.stringify(updated, null, 2)}\n`);
  success(`renamed ${from} to ${to} in ${holder.filePath}`);
};

const promptHidden = async (label: string): Promise<string> => {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").trim();
  spawnSync("stty", ["-echo"], { stdio: "inherit" });
  try {
    process.stderr.write(`${label}: `);
    const value = await new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, terminal: false });
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
    process.stderr.write("\n");
    return value;
  } finally {
    spawnSync("stty", ["echo"], { stdio: "inherit" });
  }
};

const promptLine = async (label: string): Promise<string> => {
  process.stderr.write(`${label}: `);
  const value = await new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
  process.stderr.write("\n");
  return value.trim();
};

const confirmPrompt = async (label: string): Promise<boolean> => {
  if (!process.stdin.isTTY) return false;
  process.stderr.write(`${label} [y/N] `);
  const rl = createInterface({ input: process.stdin, terminal: false });
  const answer = await new Promise<string>((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
  return /^y(es)?$/i.test(answer.trim());
};

const fieldName = (field: string): string =>
  field.startsWith("custom:") ? field.slice("custom:".length) : field;

const setItemField = (item: Record<string, any>, field: string, value: string): void => {
  if (field === "password" || field === "username") {
    item.login = item.login || {};
    item.login[field] = value;
  } else if (field === "notes") {
    item.notes = value;
  } else {
    const name = fieldName(field);
    item.fields = Array.isArray(item.fields) ? item.fields : [];
    const entry = item.fields.find((candidate: { name?: string }) => candidate.name === name);
    if (entry) {
      entry.value = value;
    } else {
      item.fields.push({ name, value, type: 0 });
    }
  }
};

const newItem = (name: string, field: string, value: string): Record<string, any> => {
  const item: Record<string, any> = { type: 1, name };
  if (field === "password" || field === "username") {
    item.login = { [field]: value };
  } else if (field === "notes") {
    item.notes = value;
  } else {
    item.fields = [{ name: fieldName(field), value, type: 0 }];
  }
  return item;
};

const setValue = async (
  alias: string,
  definition: SecretDefinition,
  value: string,
  force: boolean,
  source?: string,
): Promise<void> => {
  await requireUnlocked();
  const field = definition.field || "password";
  const items = await vaultItems();
  const item = itemFor(items, definition.item);
  if (item === undefined) {
    const payload = newItem(definition.item, field, value);
    if (source) setItemField(payload, "custom:source", source);
    if (!(await daemonMutate("POST", "/object/item", payload))) {
      // bw 2026.x expects base64-encoded item JSON on stdin for create/edit.
      runBwInput(["create", "item"], Buffer.from(JSON.stringify(payload)).toString("base64"));
      daemonStop();
    }
    success(`created item ${definition.item}`);
    return;
  }
  if (!item.id) fail(`Bitwarden item for ${alias} has no id`);
  if (!force) {
    if (!process.stdin.isTTY) fail("item already exists; pass --force to overwrite");
    const created = formatCreatedAt(String(item.creationDate ?? ""));
    const confirmed = await confirmPrompt(`Overwrite ${definition.item} (created at ${created})?`);
    if (!confirmed) fail("aborted; use --force to overwrite without confirmation");
  }
  const payload = JSON.parse(JSON.stringify(item)) as Record<string, any>;
  setItemField(payload, field, value);
  if (source) setItemField(payload, "custom:source", source);
  if (!(await daemonMutate("PUT", `/object/item/${String(item.id)}`, payload))) {
    runBwInput(["edit", "item", String(item.id)], Buffer.from(JSON.stringify(payload)).toString("base64"));
    daemonStop();
  }
  success(`updated item ${definition.item}`);
};

const clipboardCandidates = (): Array<{ command: string; args: string[] }> =>
  process.platform === "darwin"
    ? [{ command: "pbcopy", args: [] as string[] }]
    : [
        { command: "wl-copy", args: [] as string[] },
        { command: "xclip", args: ["-selection", "clipboard"] },
      ];

const tryCopyToClipboard = (value: string): boolean => {
  for (const candidate of clipboardCandidates()) {
    const result = spawnSync(candidate.command, candidate.args, { encoding: "utf8", input: value });
    if (!result.error && result.status === 0) return true;
  }
  return false;
};

const copyToClipboard = (value: string): void => {
  if (!tryCopyToClipboard(value)) {
    const candidates = clipboardCandidates();
    fail(`no clipboard tool available (tried ${candidates.map((candidate) => candidate.command).join(", ")})`);
  }
};

const deliverValue = (value: string, alias: string): void => {
  if (tryCopyToClipboard(value)) {
    success(`copied ${alias} to clipboard`);
  } else {
    console.log(value);
    warn(`clipboard unavailable, printed ${alias} value above`);
  }
};

const doctor = async (definitions: Record<string, SecretDefinition>): Promise<void> => {
  const current = await currentAuthState();
  if (!current.authenticated) {
    console.log('bitwarden: unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"');
    process.exit(1);
  }
  if (!current.unlocked) {
    console.log('bitwarden: locked — unlock with: export BW_SESSION="$(bw unlock --raw)"');
    process.exit(1);
  }
  console.log("bitwarden: unlocked");
  if (process.env.SECRET_DAEMON === "0") {
    console.log("daemon\tdisabled");
  } else {
    console.log((await daemonStatus()) === "unlocked" ? "daemon\tup" : "daemon\tdown");
  }

  let problems = 0;
  const items = await vaultItems();
  for (const [alias, definition] of Object.entries(definitions)) {
    const field = definition.field || "password";
    const item = itemFor(items, definition.item);
    if (item === undefined) {
      console.log(`missing\t${alias}\t${definition.item}`);
      problems += 1;
      continue;
    }
    const value = itemField(item, field);
    if (typeof value !== "string" || !value || placeholderValues.has(value)) {
      console.log(`invalid value\t${alias}\t${definition.item}\t${field}`);
      problems += 1;
      continue;
    }
    console.log(`ok\t${alias}\t${definition.item}\t${field}`);
  }

  const total = Object.keys(definitions).length;
  const summary = `secret doctor: ${total - problems}/${total} aliases ok, ${problems} problem(s)`;
  console.error(problems > 0 ? warn(summary) : success(summary));
  if (problems > 0) process.exit(1);
};

const commandHelpText: Record<string, string> = {
  status: `Usage: secret status [--check]

Check Bitwarden auth state and print the next command to run.

  --check   Exit nonzero when not unlocked
`,
  unlock: `Usage: secret unlock [--store]

Unlock and print a session token. A session already present in the
environment (e.g. the one bw login prints) is reused without prompting.

  --store   Persist the session (macOS keychain, or ~/.config/secret/session)
`,
  lock: `Usage: secret lock

Lock the vault, clear any stored session, and stop the daemon.
`,
  list: `Usage: secret list [--env NAME] [--json]

List configured aliases. Created dates are fetched only on a TTY.

  --env NAME   Environment overrides (default: prod)
  --json       Machine-readable rows on stdout
`,
  search: `Usage: secret search <term> [--json]

Find aliases by alias, item, or env key across scopes (no values).
`,
  get: `Usage: secret get <alias> [--copy] [--env NAME]

Print exactly one configured value.

  --copy       Copy to the clipboard instead of stdout
  --env NAME   Environment override (default: prod)
`,
  set: `Usage: secret set [<alias>] [--generate] [--force] [--source URL] [--global]

Prompt (hidden) for a value and write it to Bitwarden. A missing alias is
added to the project config and created in the vault; with no alias at all,
you are prompted for one.

  --generate   Generate a random password instead of prompting
  --force, -f  Overwrite an existing item without confirmation
  --source URL Attach a source URL (stored as a custom "source" field)
  --global, -g Add a new alias to the global config instead of the project one
`,
  id: `Usage: secret id <alias>

Print the resolved Bitwarden item id (no value).
`,
  totp: `Usage: secret totp <alias> [--copy]

Print the current TOTP code.
`,
  source: `Usage: secret source <alias> [url]

Print the secret's source URL (a custom "source" field on the vault item),
or set it when a url is given.
`,
  pull: `Usage: secret pull

Refresh the local vault cache from the server (bw sync).
`,
  pin: `Usage: secret pin <alias>

Replace the config item name with its resolved id.
`,
  rotate: `Usage: secret rotate <alias> [--force] [--copy]

Generate a new password and overwrite the item; delivers the new value.
`,
  rm: `Usage: secret rm <alias> [--force] [--global]

Delete the vault item (config entry kept). Falls back to unsetting the alias
when the item does not exist in the vault. --global unsets from the global
config instead of the project one.
`,
  unset: `Usage: secret unset <alias> [--global]

Remove an alias from the project config (or the global config with --global).
`,
  mv: `Usage: secret mv <alias> <new>

Rename an alias in the project or user config.
`,
  init: `Usage: secret init [--force] [alias..]

Scaffold a .secret.json template; optional aliases to prefill.
`,
  env: `Usage: secret env [--output FILE] [--env NAME] [--export] [--diff|--dry|--dry-run] [--required a,b,c] [--optional a,b,c]

Generate dotenv from the project config. Strict by default: every alias must
resolve. Pass --optional to warn-and-skip unresolved aliases.

  --output FILE     Atomically write the dotenv to FILE (mode 0600)
  --env NAME        Environment overrides (default: prod)
  --export          Print shell export lines instead of dotenv
  --diff, --dry, --dry-run
                    Show what --output would write without writing
  --required a,b,c  Fail unless these aliases are in the config
  --optional a,b,c  Warn and skip aliases that cannot resolve
`,
  run: `Usage: secret run [--optional a,b,c] -- <cmd...>

Inject project aliases into a command's environment. Strict by default;
--optional warns and skips unresolved aliases.
`,
  print: `Usage: secret print [project|global|local] [--all] [--json]

Show aliases without touching the vault.
`,
  global: `Usage: secret global [add|unset <alias>] [--json]

Show the global (user) scope aliases (same as secret print global), or
delegate: secret global add <alias> = secret set --global <alias>, and
secret global unset <alias> = secret unset --global <alias>.
`,
  prune: `Usage: secret prune [--dry-run] [--global]

Remove config aliases whose vault items no longer exist. --dry-run only lists
them; --global prunes the user config instead of the project one.
`,
  lint: `Usage: secret lint [--config FILE] [--json]

Validate configs offline: items, env keys, collisions (no vault).
`,
  doctor: `Usage: secret doctor

Validate configs, Bitwarden state, and alias resolvability.
`,
  recent: `Usage: secret recent [--json]

Show recently used aliases.
`,
  history: `Usage: secret history [--json]

Show recent secret commands (aliases only, no values).
`,
};

const printHelp = (): void => {
  console.log(`Usage: secret <status|unlock|lock|list|search|get|set|id|totp|source|pull|pin|rotate|rm|unset|mv|init|env|run|print|global|prune|lint|doctor|recent|history> [options]

Commands:
  status (st)         Check Bitwarden auth state and print the next command to run
  unlock              Unlock and print a session token (--store persists it)
  lock                Lock the vault and clear any stored session
  list (ls)           List configured aliases (vault touched only for created dates on a TTY)
  search <term>       Find aliases by alias, item, or env key across scopes (no values)
  get (g) <alias>     Print exactly one configured value
  set (s, add) [<alias>]
                      Prompt (hidden) a value and write it to Bitwarden; a missing
                      alias is added to the config and created in the vault
  id <alias>          Print the resolved Bitwarden item id (no value)
  totp <alias>        Print the current TOTP code (--copy to clipboard)
  source (so) <alias> [url]
                      Print the secret's source URL, or set it when a url is given
  pull (pu, sync)     Refresh the local vault cache from the server (bw sync)
  pin <alias>         Replace the config item name with its resolved id
  rotate <alias>      Generate a new password and overwrite the item (confirm unless --force); delivers the new value
  rm (delete, remove) <alias>
                      Delete the vault item (confirm unless --force); falls back
                      to unset when the item does not exist in the vault
  unset <alias>       Remove an alias from the project or user config
  mv <alias> <new>    Rename an alias in the project or user config
  init [alias..]      Scaffold a .secret.json template; optional aliases to prefill
  env (e)             Generate dotenv from the project config
  run <cmd...>        Inject project aliases into a command's environment (secret run -- npm test)
  print (pr) [scope]  Show aliases in project (default), global, or local; --all merges scopes
  global              Show the global (user) scope aliases
  prune [--dry-run]   Remove config aliases whose vault items no longer exist
  lint                Validate configs offline: items, env keys, collisions (no vault)
  doctor (d)          Validate configs, Bitwarden state, and alias resolvability
  recent              Show recently used aliases
  history             Show recent secret commands

Options:
  --config FILE       Use FILE instead of ./.secret.json
  --output FILE       With env: atomically write dotenv to FILE (mode 0600)
  --env NAME          With env/list/get/set: environment overrides (default: prod)
  --required a,b,c    With env: fail unless these aliases are in the project config
  --optional a,b,c    With env/run: warn and skip aliases that are undeclared or cannot resolve
  --copy              With get: copy the value to the clipboard instead of stdout
  --check             With status: exit nonzero when not unlocked
  --export            With env: print shell export lines instead of dotenv
  --json              With list/print/history/recent: machine-readable JSON on stdout
  --all               With print: merge project, global, and local scopes
  --diff, --dry, --dry-run
                      With env: show what --output would write without writing (default target ./.env)
  -h, --help          Show this help; accepted after any command
  --store             With unlock: persist the session token to ~/.config/secret/session (mode 0600)
  --generate          With set: generate a random password instead of prompting
  --force, -f         With set: overwrite an existing item without confirmation
  --source URL        With set: attach a source URL (custom "source" field)
  --global, -g        With set/unset/rm: operate on the global config

Config precedence (later wins):
  ~/.config/secret/config.json    personal global aliases
  ./.secret.json                  project aliases
  ./.secret.local.json            local overrides (gitignored)

Start with 'secret status', then 'secret list' to see aliases, and
'secret env --output .env' to generate a project .env file.
Use 'secret print' to inspect a single scope without vault access.`);
};

const main = async (): Promise<void> => {
  const options = parseOptions(Bun.argv.slice(2));
  options.command = commandAliases[options.command] || options.command;
  // `secret global add|unset <alias>` delegate to the --global forms.
  if (options.command === "global" && options.positional[0] === "add") {
    options.command = "set";
    options.global = true;
    options.positional = options.positional.slice(1);
  } else if (options.command === "global" && options.positional[0] === "unset") {
    options.command = "unset";
    options.global = true;
    options.positional = options.positional.slice(1);
  }
  const environment = options.envName || "prod";
  const loaded =
    options.command === "lint"
      ? { definitions: {} as Record<string, SecretDefinition>, selectedAliases: undefined }
      : loadDefinitions(options.configPath, environment);

  const wantsHelp =
    options.command === "help" ||
    options.command === "--help" ||
    options.command === "-h" ||
    options.positional.includes("-h") ||
    options.positional.includes("--help");
  if (wantsHelp) {
    const requested = [options.command, ...options.positional]
      .filter((item) => item !== "-h" && item !== "--help" && item !== "help")
      .find((item) => commandHelpText[item]);
    if (requested) {
      console.log(commandHelpText[requested]);
    } else {
      printHelp();
    }
  } else if (options.command === "status") {
    const current = await currentAuthState();
    if (current.unlocked) {
      const daemonUp = (await daemonStatus()) === "unlocked";
      console.log(
        outColor("32")(
          `unlocked — ready. next: secret list, or secret env --output .env${daemonUp ? " (daemon up)" : ""}`,
        ),
      );
    } else {
      console.log(
        outColor("33")(
          current.authenticated
            ? 'locked — unlock with: export BW_SESSION="$(bw unlock --raw)"'
            : 'unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"',
        ),
      );
      if (process.env.BW_SESSION) {
        warn(
          "a session token is present but bw rejects it — run 'bw logout && bw login' once to repair, then 'secret unlock --store'",
        );
      }
      if (readSession()) {
        warn("stored session is stale — refresh with 'secret unlock --store'");
      }
      if (options.check) process.exit(1);
    }
  } else if (options.command === "unlock") {
    // Reuse a session already present in the environment (e.g. right after
    // `bw login` printed one) so the master password is typed only once.
    // The wrapper deliberately does not inject the stored session here.
    const fromEnv = Boolean(process.env.BW_SESSION);
    const token = fromEnv ? process.env.BW_SESSION || "" : runBwUnlock();
    if (!token) fail("bw unlock returned no session token");
    // bw 2026.x couples the session key to a protected auto-unlock key; a
    // rejected session here means stale secure-storage state, not a bad token.
    const check = spawnSync("bw", ["status"], {
      encoding: "utf8",
      env: { ...withoutStaleSession(), BW_SESSION: token },
    });
    if (check.status === 0) {
      try {
        const data = JSON.parse(check.stdout) as { status?: string };
        if (data.status !== "unlocked") {
          if (fromEnv) {
            fail(
              "refusing to store a rejected session — run 'bw logout && bw login' once, then 'secret unlock --store'",
            );
          }
          warn("bw rejected the new session (stale secure-storage state) — run 'bw logout && bw login' once, then unlock again");
        }
      } catch {
        // unparseable status: ignore
      }
    }
    daemonStop();
    if (options.store) {
      storeSession(token);
      success("unlocked; session stored (clear with 'secret lock')");
    } else {
      console.log(token);
    }
  } else if (options.command === "lock") {
    runBw(["lock"]);
    daemonStop();
    const hadSession = readSession() !== undefined;
    clearSession();
    console.error(hadSession ? "secret: vault locked; stored session cleared" : "secret: vault locked");
  } else if (options.command === "list") {
    const entries = Object.entries(loaded.definitions);
    if (options.json) {
      console.log(
        JSON.stringify(
          entries.map(([alias, definition]) => ({
            alias,
            item: definition.item,
            field: definition.field || "password",
            envKey: dotenvKey(alias, definition),
          })),
        ),
      );
    } else if (process.stdout.isTTY) {
      const header = ["ALIAS", "ITEM", "FIELD", "CREATED AT", "SOURCE"];
      const items = await vaultItems();
      let hidden = 0;
      const rows = entries.map(([alias, definition]) => {
        const entry = itemFor(items, definition.item);
        const created = itemCreationDate(items, definition.item);
        if (created === "-") hidden += 1;
        const source = entry ? itemField(entry, "custom:source") : undefined;
        return [
          alias,
          definition.item,
          definition.field || "password",
          created,
          typeof source === "string" && source ? source : "-",
        ];
      });
      const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column]?.length ?? 0)));
      const pad = (value: string, width: number): string => value + " ".repeat(Math.max(0, width - value.length));
      console.log(outColor("1;36")(header.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ")));
      for (const row of rows) {
        console.log(row.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  "));
      }
      if (hidden > 0) {
        warn(`created date hidden for ${hidden} item(s) — unlock the vault to show dates`);
      }
    } else {
      for (const [alias, definition] of entries) {
        console.log(`${alias}\t${definition.item}\t${definition.field || "password"}`);
      }
    }
    console.error(`secret: ${entries.length} aliases configured. next: secret get <alias>, or secret env --output .env`);
  } else if (options.command === "get") {
    const alias = options.positional[0] || fail("get requires an alias, e.g. secret get github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const value = await getValue(alias, definition);
    recordHistory({ at: new Date().toISOString(), cmd: "get", target: alias, env: environment });
    if (options.copy) {
      copyToClipboard(value);
    success(`copied ${alias} to clipboard`);
    } else {
      console.log(value);
    }
  } else if (options.command === "set") {
    let alias = options.positional[0];
    if (!alias) {
      if (!process.stdin.isTTY) fail("set requires an alias, e.g. secret set github-token (see 'secret list')");
      alias = await promptLine("Alias name");
      if (!alias || !aliasNamePattern.test(alias)) {
        fail(`invalid alias name: ${alias} (letters, digits, underscore, hyphen; must not start with a digit)`);
      }
    }
    let definition = loaded.definitions[alias];
    if (!definition) {
      // Unknown alias: add it to the project config, then create the item.
      if (!aliasNamePattern.test(alias)) {
        fail(`invalid alias name: ${alias} (letters, digits, underscore, hyphen; must not start with a digit)`);
      }
      const filePath = options.global
        ? userConfigPath
        : options.configPath || findProjectConfig() || join(process.cwd(), projectConfigName);
      const prefix = options.global ? "global" : basename(dirname(filePath));
      const item = `${prefix}/${alias.toLowerCase().replaceAll("_", "-")}`;
      const config = existsSync(filePath) ? (readJson(filePath) as SecretConfig) : {};
      config.secrets = config.secrets || {};
      config.secrets[alias] = { item, field: "password", env: alias.toUpperCase().replaceAll("-", "_") };
      writeAtomic(filePath, `${JSON.stringify(config, null, 2)}\n`);
      info(`added ${alias} (${item}) to ${filePath}`);
      definition = { item, field: "password" };
    }
    const value = options.generate
      ? await generatePassword()
      : await promptHidden(`Enter value for ${alias}`);
    if (!value || placeholderValues.has(value)) fail(`refusing empty or placeholder value for ${alias}`);
    let source = options.source;
    if (source === undefined && process.stdin.isTTY) {
      const entered = await promptLine("Source URL (optional)");
      if (entered) source = entered;
    }
    await setValue(alias, definition, value, options.force ?? false, source);
    recordHistory({ at: new Date().toISOString(), cmd: "set", target: alias, env: environment });
    success(`set ${alias} (${definition.item}, ${definition.field || "password"})`);
    if (options.generate) {
      if (options.copy) {
        copyToClipboard(value);
        success(`copied ${alias} to clipboard`);
      } else {
        deliverValue(value, alias);
      }
    }
  } else if (options.command === "id") {
    const alias = options.positional[0] || fail("id requires an alias, e.g. secret id github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const items = await vaultItems();
    const item = itemFor(items, definition.item);
    if (item === undefined) {
      await requireUnlocked();
      fail(`item not found for ${alias}: ${definition.item}`);
    }
    if (!item.id) fail(`Bitwarden item for ${alias} has no id`);
    recordHistory({ at: new Date().toISOString(), cmd: "id", target: alias, env: environment });
    console.log(String(item.id));
  } else if (options.command === "totp") {
    const alias = options.positional[0] || fail("totp requires an alias, e.g. secret totp github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    await requireUnlocked();
    const code = runBw(["get", "totp", definition.item]);
    recordHistory({ at: new Date().toISOString(), cmd: "totp", target: alias, env: environment });
    if (options.copy) {
      copyToClipboard(code);
      success(`copied ${alias} totp code to clipboard`);
    } else {
      console.log(code);
    }
  } else if (options.command === "source") {
    const alias = options.positional[0] || fail("source requires an alias, e.g. secret source github-token");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const url = options.positional[1];
    const items = await vaultItems();
    const item = itemFor(items, definition.item);
    if (item === undefined) {
      await requireUnlocked();
      fail(`item not found for ${alias}: ${definition.item}`);
    }
    if (url !== undefined) {
      const payload = JSON.parse(JSON.stringify(item)) as Record<string, any>;
      setItemField(payload, "custom:source", url);
      if (!(await daemonMutate("PUT", `/object/item/${String(payload.id)}`, payload))) {
        runBwInput(["edit", "item", String(payload.id)], Buffer.from(JSON.stringify(payload)).toString("base64"));
        daemonStop();
      }
      success(`source set for ${alias}`);
    } else {
      const value = itemField(item, "custom:source");
      console.log(typeof value === "string" && value ? value : "");
    }
  } else if (options.command === "pull") {
    await requireUnlocked();
    if (!(await daemonMutate("POST", "/sync"))) {
      runBw(["sync"]);
      daemonStop();
    }
    recordHistory({ at: new Date().toISOString(), cmd: "pull", target: "", env: environment });
    success("vault cache pulled from server");
  } else if (options.command === "pin") {
    const alias = options.positional[0] || fail("pin requires an alias, e.g. secret pin github-token (see 'secret list')");
    if (!loaded.definitions[alias]) fail(`unknown alias: ${alias} (see 'secret list')`);
    const holder = configWithAlias(alias, options.configPath || findProjectConfig(), findProjectLocalConfig());
    if (!holder) {
      fail(`alias ${alias} is not in a project, local, or user config (see 'secret print --all')`);
    }
    await requireUnlocked();
    const itemNames = new Set<string>();
    if (holder.config.secrets?.[alias]?.item) itemNames.add(holder.config.secrets[alias].item);
    for (const environment of Object.values(holder.config.environments || {})) {
      if (environment.secrets?.[alias]?.item) itemNames.add(environment.secrets[alias].item);
    }
    const items = await vaultItems();
    const ids = new Map<string, string>();
    for (const item of itemNames) {
      const entry = itemFor(items, item);
      if (entry === undefined) fail(`item not found for ${alias}: ${item}`);
      if (!entry.id) fail(`Bitwarden item has no id: ${item}`);
      ids.set(item, String(entry.id));
    }
    const updated = JSON.parse(JSON.stringify(holder.config)) as SecretConfig;
    if (updated.secrets?.[alias]?.item) updated.secrets[alias].item = ids.get(updated.secrets[alias].item)!;
    for (const environment of Object.values(updated.environments || {})) {
      if (environment.secrets?.[alias]?.item) environment.secrets[alias].item = ids.get(environment.secrets[alias].item)!;
    }
    writeAtomic(holder.filePath, `${JSON.stringify(updated, null, 2)}\n`);
    recordHistory({ at: new Date().toISOString(), cmd: "pin", target: alias, env: environment });
    console.error(`secret: pinned ${alias} in ${holder.filePath}`);
  } else if (options.command === "rotate") {
    const alias = options.positional[0] || fail("rotate requires an alias, e.g. secret rotate github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const value = await generatePassword();
    await setValue(alias, definition, value, options.force ?? false);
    recordHistory({ at: new Date().toISOString(), cmd: "rotate", target: alias, env: environment });
    success(`rotated ${alias} (${definition.item}, ${definition.field || "password"})`);
    if (options.copy) {
      copyToClipboard(value);
      success(`copied ${alias} to clipboard`);
    } else {
      deliverValue(value, alias);
    }
  } else if (options.command === "rm") {
    const alias = options.positional[0] || fail("rm requires an alias, e.g. secret rm github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const items = await vaultItems();
    const item = itemFor(items, definition.item);
    if (item === undefined) {
      await requireUnlocked();
      if (items !== undefined) {
        // The vault is confirmed to not contain the item: fall back to unset.
        unsetAlias(alias, options.global ? userConfigPath : options.configPath, true);
        info(`item not found in vault — removed ${alias} from config`);
        recordHistory({ at: new Date().toISOString(), cmd: "rm", target: alias, env: environment });
        return;
      }
      fail(`item not found for ${alias}: ${definition.item}`);
    }
    const name = String(item.name || definition.item);
    if (!options.force) {
      if (!process.stdin.isTTY) fail(`refusing to delete ${name} without confirmation; pass --force`);
      const confirmed = await confirmPrompt(`Delete item ${name}?`);
      if (!confirmed) fail("aborted; use --force to delete without confirmation");
    }
    if (!(await daemonMutate("DELETE", `/object/item/${String(item.id)}`))) {
      runBw(["delete", "item", definition.item]);
      daemonStop();
    }
    recordHistory({ at: new Date().toISOString(), cmd: "rm", target: alias, env: environment });
    success(`deleted item ${definition.item} for ${alias} (config entry kept)`);
  } else if (options.command === "unset") {
    const alias = options.positional[0] || fail("unset requires an alias, e.g. secret unset github-token (see 'secret list')");
    unsetAlias(alias, options.global ? userConfigPath : options.configPath);
    recordHistory({ at: new Date().toISOString(), cmd: "unset", target: alias, env: environment });
  } else if (options.command === "mv") {
    const from = options.positional[0] || fail("mv requires an alias, e.g. secret mv github-token gh-token (see 'secret list')");
    const to = options.positional[1] || fail("mv requires the new alias name, e.g. secret mv github-token gh-token");
    moveAlias(from, to, options.configPath);
    recordHistory({ at: new Date().toISOString(), cmd: "mv", target: `${from} -> ${to}`, env: environment });
  } else if (options.command === "init") {
    initProjectConfig(options.force ?? false, options.positional);
  } else if (options.command === "env") {
    if (!loaded.selectedAliases?.length) {
      fail("env requires .secret.json or --config FILE with a secrets map; see docs/bitwarden.md");
    }
    const missingRequired = options.required?.filter((alias) => !loaded.selectedAliases?.includes(alias)) || [];
    if (missingRequired.length) {
      fail(`required alias(es) not in project config: ${missingRequired.join(", ")} (add them to .secret.json)`);
    }
    const optionalSet = new Set(options.optional || []);
    for (const alias of optionalSet) {
      if (!loaded.definitions[alias]) console.error(`secret: ${alias} is not declared (optional, skipping)`);
    }
    const items = await vaultItems();
    if (items !== undefined) {
      const missing = loaded.selectedAliases.filter(
        (candidate) =>
          !optionalSet.has(candidate) && resolveOptional(items, loaded.definitions[candidate]!) === undefined,
      );
      if (missing.length > 0) {
        warn(`hint: pass --optional ${missing.join(",")} to skip unresolved aliases`);
      }
    }
    const lines: string[] = [];
    for (const alias of loaded.selectedAliases) {
      const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias}`);
      const key = dotenvKey(alias, definition);
      if (optionalSet.has(alias)) {
        const value = resolveOptional(items, definition);
        if (value === undefined) {
          warn(`skipping ${alias} (optional, unresolved)`);
          continue;
        }
        const source = resolveOptional(items, { item: definition.item, field: "custom:source" });
        if (source) lines.push(`# source: ${source}`);
        const formatted = dotenvValue(value);
        lines.push(options.export ? `export ${key}=${formatted}` : `${key}=${formatted}`);
        continue;
      }
      const value = dotenvValue(await resolveRequired(items, alias, definition));
      const source = resolveOptional(items, { item: definition.item, field: "custom:source" });
      if (source) lines.push(`# source: ${source}`);
      lines.push(options.export ? `export ${key}=${value}` : `${key}=${value}`);
    }
    if (options.diff || options.dry || options.dryRun) {
      const target = options.outputPath || join(process.cwd(), ".env");
      const previous = existsSync(target) ? readFileSync(target, "utf8").split("\n").filter((line) => line !== "") : [];
      const added = lines.filter((line) => !previous.includes(line));
      const removed = previous.filter((line) => !lines.includes(line));
      for (const line of removed) console.log(outColor("31")(`- ${line}`));
      for (const line of added) console.log(outColor("32")(`+ ${line}`));
      recordHistory({ at: new Date().toISOString(), cmd: "env", target: `${target} (diff)`, env: environment });
      info(`env --diff: ${added.length} addition(s), ${removed.length} removal(s) for ${target}`);
      return;
    }
    const output = `${lines.join("\n")}\n`;
    recordHistory({ at: new Date().toISOString(), cmd: "env", target: options.outputPath || "stdout", env: environment });
    if (options.outputPath) {
      writeAtomic(options.outputPath, output);
      success(`wrote ${lines.length} aliases (env ${environment}) to ${options.outputPath} (mode 0600)`);
    } else {
      process.stdout.write(output);
    }
  } else if (options.command === "run") {
    if (!loaded.selectedAliases?.length) {
      fail("run requires .secret.json or --config FILE with a secrets map; see docs/bitwarden.md");
    }
    const command = options.positional[0] || fail("run requires a command, e.g. secret run -- npm test");
    const envVars: Record<string, string> = {};
    const optionalSet = new Set(options.optional || []);
    for (const alias of optionalSet) {
      if (!loaded.definitions[alias]) console.error(`secret: ${alias} is not declared (optional, skipping)`);
    }
    const items = await vaultItems();
    if (items !== undefined) {
      const missing = loaded.selectedAliases.filter(
        (candidate) =>
          !optionalSet.has(candidate) && resolveOptional(items, loaded.definitions[candidate]!) === undefined,
      );
      if (missing.length > 0) {
        warn(`hint: pass --optional ${missing.join(",")} to skip unresolved aliases`);
      }
    }
    for (const alias of loaded.selectedAliases) {
      const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias}`);
      const key = dotenvKey(alias, definition);
      if (optionalSet.has(alias)) {
        const value = resolveOptional(items, definition);
        if (value === undefined) {
          warn(`skipping ${alias} (optional, unresolved)`);
          continue;
        }
        envVars[key] = value;
        continue;
      }
      envVars[key] = await resolveRequired(items, alias, definition);
    }
    recordHistory({ at: new Date().toISOString(), cmd: "run", target: command, env: environment });
    const result = spawnSync(command, options.positional.slice(1), {
      stdio: "inherit",
      env: { ...process.env, ...envVars },
    });
    if (result.error) fail(`could not run ${command}: ${result.error.message}`);
    process.exit(result.status ?? 1);
  } else if (options.command === "print") {
    if (options.all) {
      printAllScopes(options.configPath, options.json ?? false);
      recordHistory({ at: new Date().toISOString(), cmd: "print", target: "all", env: environment });
    } else {
      const scope = options.positional[0] || "project";
      printScope(scope, options.configPath, options.json ?? false);
      recordHistory({ at: new Date().toISOString(), cmd: "print", target: scope, env: environment });
    }
  } else if (options.command === "global") {
    printScope("global", options.configPath, options.json ?? false);
    recordHistory({ at: new Date().toISOString(), cmd: "global", target: "global", env: environment });
  } else if (options.command === "prune") {
    if (!loaded.selectedAliases?.length) {
      fail("prune requires .secret.json or --config FILE with a secrets map; see docs/bitwarden.md");
    }
    const items = await vaultItems();
    if (items === undefined) {
      await requireUnlocked();
      fail("could not read vault items — cannot prune");
    }
    const missing = loaded.selectedAliases.filter(
      (alias) => itemFor(items, loaded.definitions[alias]!.item) === undefined,
    );
    for (const alias of missing) {
      const definition = loaded.definitions[alias]!;
      if (options.dryRun) {
        info(`would remove ${alias} (${definition.item})`);
      } else {
        unsetAlias(alias, options.global ? userConfigPath : options.configPath, true);
      }
    }
    if (options.dryRun) {
      if (missing.length > 0) warn(`prune: ${missing.length} alias(es) would be removed`);
      else info("prune: no aliases missing from the vault");
    } else if (missing.length > 0) {
      success(`pruned ${missing.length} alias(es) from config`);
    } else {
      info("prune: no aliases missing from the vault");
    }
    recordHistory({ at: new Date().toISOString(), cmd: "prune", target: missing.join(","), env: environment });
  } else if (options.command === "search") {
    const query = options.positional[0] || fail("search requires a term, e.g. secret search token (matches alias, item, env key)");
    searchAliases(query, options.configPath, options.json ?? false);
    recordHistory({ at: new Date().toISOString(), cmd: "search", target: query, env: environment });
  } else if (options.command === "lint") {
    lint(options.configPath, options.json ?? false);
  } else if (options.command === "doctor") {
    await doctor(loaded.definitions);
  } else if (options.command === "recent") {
    printRecent(options.json ?? false);
  } else if (options.command === "history") {
    printHistory(options.json ?? false);
  } else {
    fail(`unknown command: ${options.command}`);
  }
};

main().catch((error) => {
  console.error(errColor("31")(`secret: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(1);
});
