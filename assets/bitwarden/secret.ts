#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

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
  copy?: boolean;
  check?: boolean;
  generate?: boolean;
  force?: boolean;
  export?: boolean;
  json?: boolean;
  all?: boolean;
  diff?: boolean;
};

const home = homedir();
const defaultsPath = process.env.SECRET_DEFAULTS_FILE || join(home, ".config", "secret", "defaults.json");
const userConfigPath = join(home, ".config", "secret", "config.json");
const historyPath = join(home, ".config", "secret", "history.json");
const projectConfigName = ".secret.json";
const placeholderValues = new Set(["replace-me", "REPLACE-ME"]);
const HISTORY_LIMIT = 100;

const commandAliases: Record<string, string> = {
  st: "status",
  ls: "list",
  g: "get",
  s: "set",
  i: "id",
  in: "init",
  t: "totp",
  sy: "sync",
  p: "pin",
  r: "rotate",
  u: "unset",
  l: "lint",
  e: "env",
  d: "doctor",
  pr: "print",
  re: "recent",
  h: "history",
};

type HistoryEntry = {
  at: string;
  cmd: string;
  target: string;
  env?: string;
};

const fail = (message: string, code = 1): never => {
  console.error(`secret: ${message}`);
  process.exit(code);
};

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

const findProjectConfig = (): string | undefined => {
  let directory = process.cwd();
  for (;;) {
    const candidate = join(directory, projectConfigName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (directory === home || parent === directory) return undefined;
    directory = parent;
  }
};

const configContainsAlias = (config: SecretConfig, alias: string): boolean =>
  config.secrets?.[alias] !== undefined ||
  Object.values(config.environments || {}).some((environment) => environment.secrets?.[alias] !== undefined);

const configWithAlias = (alias: string, projectPath?: string): { filePath: string; config: SecretConfig } | undefined => {
  for (const filePath of projectPath ? [projectPath] : []) {
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
  let copy = false;
  let check = false;
  let generate = false;
  let force = false;
  let exportOutput = false;
  let json = false;
  let all = false;
  let diff = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
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
    } else if (argument === "--copy") {
      copy = true;
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--generate") {
      generate = true;
    } else if (argument === "--force" || argument === "-f") {
      force = true;
    } else if (argument === "--export") {
      exportOutput = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--all") {
      all = true;
    } else if (argument === "--diff") {
      diff = true;
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
    copy,
    check,
    generate,
    force,
    export: exportOutput,
    json,
    all,
    diff,
  };
};

const loadDefinitions = (selectedConfig?: string, environment = "prod"): {
  definitions: Record<string, SecretDefinition>;
  selectedAliases?: string[];
} => {
  const defaults = optionalConfig(defaultsPath);
  const user = optionalConfig(userConfigPath);
  const projectPath = selectedConfig || findProjectConfig();
  const project = projectPath ? readJson(projectPath) : {};
  const definitions = {
    ...(defaults.secrets || {}),
    ...(user.secrets || {}),
    ...(project.secrets || {}),
  };

  if (environment !== "prod") {
    const sources = [defaults, user, project];
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

  return {
    definitions,
    selectedAliases: projectPath ? [...new Set(projectAliases)] : undefined,
  };
};

const runBw = (arguments_: string[]): string => {
  const result = spawnSync("bw", arguments_, { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail("Bitwarden CLI request failed");
  return result.stdout.trim();
};

const runBwInput = (arguments_: string[], input: string): string => {
  const result = spawnSync("bw", arguments_, { encoding: "utf8", input });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail("Bitwarden CLI request failed");
  return result.stdout.trim();
};

const tryGetItemRaw = (item: string): string | undefined => {
  const result = spawnSync("bw", ["get", "item", item, "--raw"], { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  return result.status === 0 ? result.stdout.trim() : undefined;
};

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

const requireUnlocked = (): void => {
  const current = status();
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

const getValue = (alias: string, definition: SecretDefinition): string => {
  requireUnlocked();
  const raw = runBw(["get", "item", definition.item, "--raw"]);
  let item: Record<string, any>;
  try {
    item = JSON.parse(raw) as Record<string, any>;
  } catch {
    fail(`Bitwarden returned invalid item data for ${alias}`);
  }
  const value = itemField(item, definition.field || "password");
  if (typeof value !== "string" || !value || placeholderValues.has(value)) {
    fail(`missing or invalid value for ${alias}`);
  }
  return value;
};

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
      fail(`invalid alias name: ${alias} (letters, digits, underscore; must not start with a digit)`);
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

const SCOPE_ORDER: Record<string, number> = { project: 0, global: 1, nix: 2 };

const sortRows = (rows: PrintRow[]): void => {
  rows.sort((a, b) =>
    a.alias === b.alias
      ? SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || (a.env < b.env ? -1 : 1)
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
    ...scopeRows("nix", defaultsPath),
  ];
  sortRows(rows);
  return rows;
};

const printAllScopes = (selectedConfig: string | undefined, json: boolean): void => {
  const rows = mergedRows(selectedConfig);
  emitRows(rows, json, true);
  console.error(`secret print: ${rows.length} aliases across project, global, and nix scopes. next: secret get <alias>, or secret env --output .env`);
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
    { scope: "nix", filePath: defaultsPath },
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
  console.error(`secret lint: clean — ${count} alias(es) across project, global, and nix. next: secret doctor, or secret env --output .env`);
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
  } else if (scope === "nix") {
    printConfig("nix", defaultsPath, json);
  } else {
    fail(`unknown scope: ${scope} (available: project, global, nix)`);
  }
};

const unsetAlias = (alias: string, selectedConfig?: string): void => {
  const holder = configWithAlias(alias, selectedConfig || findProjectConfig());
  if (!holder) {
    fail(`alias ${alias} is only in the Nix-managed ${defaultsPath}; copy it to a project or user config to remove it`);
  }
  const updated = JSON.parse(JSON.stringify(holder.config)) as SecretConfig;
  delete updated.secrets?.[alias];
  for (const environment of Object.values(updated.environments || {})) delete environment.secrets?.[alias];
  writeAtomic(holder.filePath, `${JSON.stringify(updated, null, 2)}\n`);
  console.error(`secret: removed ${alias} from ${holder.filePath}`);
};

const aliasNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const moveAlias = (from: string, to: string, selectedConfig?: string): void => {
  if (!aliasNamePattern.test(to)) {
    fail(`invalid alias name: ${to} (letters, digits, underscore; must not start with a digit)`);
  }
  if (from === to) fail(`alias is already named ${to}`);
  const holder = configWithAlias(from, selectedConfig || findProjectConfig());
  if (!holder) {
    fail(`alias ${from} is only in the Nix-managed ${defaultsPath}; copy it to a project or user config to rename it`);
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
  console.error(`secret: renamed ${from} to ${to} in ${holder.filePath}`);
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

const setValue = async (alias: string, definition: SecretDefinition, value: string, force: boolean): Promise<void> => {
  requireUnlocked();
  const field = definition.field || "password";
  const raw = tryGetItemRaw(definition.item);
  if (raw === undefined) {
    runBwInput(["create", "item"], JSON.stringify(newItem(definition.item, field, value)));
    console.error(`secret: created item ${definition.item}`);
  } else {
    let item: Record<string, any>;
    try {
      item = JSON.parse(raw) as Record<string, any>;
    } catch {
      fail(`Bitwarden returned invalid item data for ${alias}`);
    }
    if (!item.id) fail(`Bitwarden item for ${alias} has no id`);
    if (!force) {
      if (!process.stdin.isTTY) fail("item already exists; pass --force to overwrite");
      const created = item.creationDate ? String(item.creationDate).slice(0, 10) : "unknown date";
      const confirmed = await confirmPrompt(`Overwrite ${definition.item} (created ${created})?`);
      if (!confirmed) fail("aborted; use --force to overwrite without confirmation");
    }
    setItemField(item, field, value);
    runBwInput(["edit", "item", String(item.id)], Buffer.from(JSON.stringify(item)).toString("base64"));
    console.error(`secret: updated item ${definition.item}`);
  }
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
    console.error(`secret: copied ${alias} to clipboard`);
  } else {
    console.log(value);
    console.error(`secret: clipboard unavailable, printed ${alias} value above`);
  }
};

const doctor = (definitions: Record<string, SecretDefinition>): void => {
  const current = status();
  if (!current.authenticated) {
    console.log('bitwarden: unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"');
    process.exit(1);
  }
  if (!current.unlocked) {
    console.log('bitwarden: locked — unlock with: export BW_SESSION="$(bw unlock --raw)"');
    process.exit(1);
  }
  console.log("bitwarden: unlocked");

  let problems = 0;
  for (const [alias, definition] of Object.entries(definitions)) {
    const field = definition.field || "password";
    const raw = tryGetItemRaw(definition.item);
    if (raw === undefined) {
      console.log(`missing\t${alias}\t${definition.item}`);
      problems += 1;
      continue;
    }
    let item: Record<string, any>;
    try {
      item = JSON.parse(raw) as Record<string, any>;
    } catch {
      console.log(`invalid\t${alias}\t${definition.item}`);
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
  console.error(`secret doctor: ${total - problems}/${total} aliases ok, ${problems} problem(s)`);
  if (problems > 0) process.exit(1);
};

const printHelp = (): void => {
  console.log(`Usage: secret <status|list|search|get|set|id|totp|sync|pin|rotate|rm|unset|mv|init|env|print|lint|doctor|recent|history> [options]

Commands:
  status (st)         Check Bitwarden auth state and print the next command to run
  list (ls)           List configured aliases (never touches the vault)
  search <term>       Find aliases by alias, item, or env key across scopes (no values)
  get (g) <alias>     Print exactly one configured value
  set (s) <alias>     Prompt (hidden) a value and write it to Bitwarden; --generate delivers the new value
  id (i) <alias>      Print the resolved Bitwarden item id (no value)
  totp (t) <alias>    Print the current TOTP code (--copy to clipboard)
  sync (sy)           Refresh the Bitwarden vault cache (explicit)
  pin (p) <alias>     Replace the config item name with its resolved id
  rotate (r) <alias>  Generate a new password and overwrite the item (confirm unless --force); delivers the new value
  rm <alias>          Delete the vault item (confirm unless --force); config entry kept
  unset (u) <alias>   Remove an alias from the project or user config
  mv <alias> <new>    Rename an alias in the project or user config
  init (in) [alias..] Scaffold a .secret.json template; optional aliases to prefill
  env (e)             Generate dotenv from the project config
  print (pr) [scope]  Show aliases in project (default), global, or nix; --all merges scopes
  lint (l)            Validate configs offline: items, env keys, collisions (no vault)
  doctor (d)          Validate configs, Bitwarden state, and alias resolvability
  recent (re)         Show recently used aliases
  history (h)         Show recent secret commands

Options:
  --config FILE       Use FILE instead of ./.secret.json
  --output FILE       With env: atomically write dotenv to FILE (mode 0600)
  --env NAME          With env/list/get/set: environment overrides (default: prod)
  --required a,b,c    With env: fail unless these aliases are in the project config
  --copy              With get: copy the value to the clipboard instead of stdout
  --check             With status: exit nonzero when not unlocked
  --export            With env: print shell export lines instead of dotenv
  --json              With list/print/history/recent: machine-readable JSON on stdout
  --all               With print: merge project, global, and nix scopes
  --diff              With env: show what --output would write without writing (default target ./.env)
  --generate          With set: generate a random password instead of prompting
  --force, -f         With set: overwrite an existing item without confirmation

Config precedence (later wins):
  ~/.config/secret/defaults.json  Nix-managed global aliases
  ~/.config/secret/config.json    personal global aliases
  ./.secret.json                  project aliases

Start with 'secret status', then 'secret list' to see aliases, and
'secret env --output .env' to generate a project .env file.
Use 'secret print' to inspect a single scope without vault access.`);
};

const main = async (): Promise<void> => {
  const options = parseOptions(Bun.argv.slice(2));
  options.command = commandAliases[options.command] || options.command;
  const environment = options.envName || "prod";
  const loaded =
    options.command === "lint"
      ? { definitions: {} as Record<string, SecretDefinition>, selectedAliases: undefined }
      : loadDefinitions(options.configPath, environment);

  if (options.command === "help" || options.command === "--help" || options.command === "-h") {
    printHelp();
  } else if (options.command === "status") {
    const current = status();
    if (current.unlocked) {
      console.log("unlocked — ready. next: secret list, or secret env --output .env");
    } else {
      console.log(
        current.authenticated
          ? 'locked — unlock with: export BW_SESSION="$(bw unlock --raw)"'
          : 'unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"',
      );
      if (options.check) process.exit(1);
    }
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
    } else {
      for (const [alias, definition] of entries) {
        console.log(`${alias}\t${definition.item}\t${definition.field || "password"}`);
      }
    }
    console.error(`secret: ${entries.length} aliases configured. next: secret get <alias>, or secret env --output .env`);
  } else if (options.command === "get") {
    const alias = options.positional[0] || fail("get requires an alias, e.g. secret get github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const value = getValue(alias, definition);
    recordHistory({ at: new Date().toISOString(), cmd: "get", target: alias, env: environment });
    if (options.copy) {
      copyToClipboard(value);
      console.error(`secret: copied ${alias} to clipboard`);
    } else {
      console.log(value);
    }
  } else if (options.command === "set") {
    const alias = options.positional[0] || fail("set requires an alias, e.g. secret set github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    const value = options.generate
      ? runBw(["generate", "-ulns", "--length", "32"])
      : await promptHidden(`Enter value for ${alias}`);
    if (!value || placeholderValues.has(value)) fail(`refusing empty or placeholder value for ${alias}`);
    await setValue(alias, definition, value, options.force ?? false);
    recordHistory({ at: new Date().toISOString(), cmd: "set", target: alias, env: environment });
    console.error(`secret: set ${alias} (${definition.item}, ${definition.field || "password"})`);
    if (options.generate) {
      if (options.copy) {
        copyToClipboard(value);
        console.error(`secret: copied ${alias} to clipboard`);
      } else {
        deliverValue(value, alias);
      }
    }
  } else if (options.command === "id") {
    const alias = options.positional[0] || fail("id requires an alias, e.g. secret id github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    requireUnlocked();
    const raw = tryGetItemRaw(definition.item);
    if (raw === undefined) fail(`item not found for ${alias}: ${definition.item}`);
    let item: Record<string, any>;
    try {
      item = JSON.parse(raw) as Record<string, any>;
    } catch {
      fail(`Bitwarden returned invalid item data for ${alias}`);
    }
    if (!item.id) fail(`Bitwarden item for ${alias} has no id`);
    recordHistory({ at: new Date().toISOString(), cmd: "id", target: alias, env: environment });
    console.log(String(item.id));
  } else if (options.command === "totp") {
    const alias = options.positional[0] || fail("totp requires an alias, e.g. secret totp github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    requireUnlocked();
    const code = runBw(["get", "totp", definition.item]);
    recordHistory({ at: new Date().toISOString(), cmd: "totp", target: alias, env: environment });
    if (options.copy) {
      copyToClipboard(code);
      console.error(`secret: copied ${alias} totp code to clipboard`);
    } else {
      console.log(code);
    }
  } else if (options.command === "sync") {
    requireUnlocked();
    runBw(["sync"]);
    recordHistory({ at: new Date().toISOString(), cmd: "sync", target: "", env: environment });
    console.error("secret: vault synced");
  } else if (options.command === "pin") {
    const alias = options.positional[0] || fail("pin requires an alias, e.g. secret pin github-token (see 'secret list')");
    if (!loaded.definitions[alias]) fail(`unknown alias: ${alias} (see 'secret list')`);
    const holder = configWithAlias(alias, options.configPath || findProjectConfig());
    if (!holder) {
      fail(`alias ${alias} is only in the Nix-managed ${defaultsPath}; copy it to a project or user config to pin`);
    }
    requireUnlocked();
    const itemNames = new Set<string>();
    if (holder.config.secrets?.[alias]?.item) itemNames.add(holder.config.secrets[alias].item);
    for (const environment of Object.values(holder.config.environments || {})) {
      if (environment.secrets?.[alias]?.item) itemNames.add(environment.secrets[alias].item);
    }
    const ids = new Map<string, string>();
    for (const item of itemNames) {
      const raw = tryGetItemRaw(item);
      if (raw === undefined) fail(`item not found for ${alias}: ${item}`);
      try {
        const parsed = JSON.parse(raw) as { id?: string };
        if (!parsed.id) fail(`Bitwarden item has no id: ${item}`);
        ids.set(item, parsed.id);
      } catch {
        fail(`Bitwarden returned invalid item data for ${alias}`);
      }
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
    const value = runBw(["generate", "-ulns", "--length", "32"]);
    await setValue(alias, definition, value, options.force ?? false);
    recordHistory({ at: new Date().toISOString(), cmd: "rotate", target: alias, env: environment });
    console.error(`secret: rotated ${alias} (${definition.item}, ${definition.field || "password"})`);
    if (options.copy) {
      copyToClipboard(value);
      console.error(`secret: copied ${alias} to clipboard`);
    } else {
      deliverValue(value, alias);
    }
  } else if (options.command === "rm") {
    const alias = options.positional[0] || fail("rm requires an alias, e.g. secret rm github-token (see 'secret list')");
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
    requireUnlocked();
    const raw = tryGetItemRaw(definition.item);
    if (raw === undefined) fail(`item not found for ${alias}: ${definition.item}`);
    let item: Record<string, any>;
    try {
      item = JSON.parse(raw) as Record<string, any>;
    } catch {
      fail(`Bitwarden returned invalid item data for ${alias}`);
    }
    const name = String(item.name || definition.item);
    if (!options.force) {
      if (!process.stdin.isTTY) fail(`refusing to delete ${name} without confirmation; pass --force`);
      const confirmed = await confirmPrompt(`Delete item ${name}?`);
      if (!confirmed) fail("aborted; use --force to delete without confirmation");
    }
    runBw(["delete", "item", definition.item]);
    recordHistory({ at: new Date().toISOString(), cmd: "rm", target: alias, env: environment });
    console.error(`secret: deleted item ${definition.item} for ${alias} (config entry kept)`);
  } else if (options.command === "unset") {
    const alias = options.positional[0] || fail("unset requires an alias, e.g. secret unset github-token (see 'secret list')");
    unsetAlias(alias, options.configPath);
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
    const lines = loaded.selectedAliases.map((alias) => {
      const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias}`);
      const key = dotenvKey(alias, definition);
      const value = dotenvValue(getValue(alias, definition));
      return options.export ? `export ${key}=${value}` : `${key}=${value}`;
    });
    if (options.diff) {
      const target = options.outputPath || join(process.cwd(), ".env");
      const previous = existsSync(target) ? readFileSync(target, "utf8").split("\n").filter((line) => line !== "") : [];
      const added = lines.filter((line) => !previous.includes(line));
      const removed = previous.filter((line) => !lines.includes(line));
      for (const line of removed) console.log(`- ${line}`);
      for (const line of added) console.log(`+ ${line}`);
      recordHistory({ at: new Date().toISOString(), cmd: "env", target: `${target} (diff)`, env: environment });
      console.error(`secret env --diff: ${added.length} addition(s), ${removed.length} removal(s) for ${target}`);
      return;
    }
    const output = `${lines.join("\n")}\n`;
    recordHistory({ at: new Date().toISOString(), cmd: "env", target: options.outputPath || "stdout", env: environment });
    if (options.outputPath) {
      writeAtomic(options.outputPath, output);
      console.error(`secret: wrote ${lines.length} aliases (env ${environment}) to ${options.outputPath} (mode 0600)`);
    } else {
      process.stdout.write(output);
    }
  } else if (options.command === "print") {
    if (options.all) {
      printAllScopes(options.configPath, options.json);
      recordHistory({ at: new Date().toISOString(), cmd: "print", target: "all", env: environment });
    } else {
      const scope = options.positional[0] || "project";
      printScope(scope, options.configPath, options.json);
      recordHistory({ at: new Date().toISOString(), cmd: "print", target: scope, env: environment });
    }
  } else if (options.command === "search") {
    const query = options.positional[0] || fail("search requires a term, e.g. secret search token (matches alias, item, env key)");
    searchAliases(query, options.configPath, options.json);
    recordHistory({ at: new Date().toISOString(), cmd: "search", target: query, env: environment });
  } else if (options.command === "lint") {
    lint(options.configPath, options.json);
  } else if (options.command === "doctor") {
    doctor(loaded.definitions);
  } else if (options.command === "recent") {
    printRecent(options.json);
  } else if (options.command === "history") {
    printHistory(options.json);
  } else {
    fail(`unknown command: ${options.command}`);
  }
};

main().catch((error) => {
  console.error(`secret: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
