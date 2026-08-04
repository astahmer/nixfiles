#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type SecretDefinition = {
  item: string;
  field?: string;
  env?: string;
};

type SecretConfig = {
  secrets?: Record<string, SecretDefinition>;
};

type ParsedOptions = {
  command: string;
  positional: string[];
  configPath?: string;
  outputPath?: string;
};

const home = homedir();
const defaultsPath = process.env.SECRET_DEFAULTS_FILE || join(home, ".config", "secret", "defaults.json");
const userConfigPath = join(home, ".config", "secret", "config.json");
const projectConfigName = ".secret.json";
const placeholderValues = new Set(["replace-me", "REPLACE-ME"]);

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
  const candidate = join(process.cwd(), projectConfigName);
  return existsSync(candidate) ? candidate : undefined;
};

const parseOptions = (argv: string[]): ParsedOptions => {
  const positional: string[] = [];
  let selectedConfig: string | undefined;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      selectedConfig = argv[++index] || fail("--config requires a file path");
    } else if (argument === "--output") {
      outputPath = argv[++index] || fail("--output requires a file path");
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
  };
};

const loadDefinitions = (selectedConfig?: string): {
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

  for (const [alias, definition] of Object.entries(definitions)) {
    if (!definition || typeof definition.item !== "string" || !definition.item) {
      fail(`invalid definition for ${alias}`);
    }
  }

  return {
    definitions,
    selectedAliases: projectPath ? Object.keys(project.secrets || {}) : undefined,
  };
};

const runBw = (arguments_: string[]): string => {
  const result = spawnSync("bw", arguments_, { encoding: "utf8" });
  if (result.error) fail(`could not run Bitwarden CLI (is 'bw' installed?): ${result.error.message}`);
  if (result.status !== 0) fail("Bitwarden CLI request failed");
  return result.stdout.trim();
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

const printHelp = (): void => {
  console.log(`Usage: secret <status|list|get|env> [options]

Commands:
  status              Check Bitwarden auth state and print the next command to run
  list                List configured aliases (never touches the vault)
  get <alias>         Print exactly one configured value
  env                 Generate dotenv from the project config

Options:
  --config FILE       Use FILE instead of ./.secret.json
  --output FILE       With env: atomically write dotenv to FILE (mode 0600)

Config precedence (later wins):
  ~/.config/secret/defaults.json  Nix-managed global aliases
  ~/.config/secret/config.json    personal global aliases
  ./.secret.json                  project aliases

Start with 'secret status', then 'secret list' to see aliases, and
'secret env --output .env' to generate a project .env file.`);
};

const options = parseOptions(Bun.argv.slice(2));
const loaded = loadDefinitions(options.configPath);

if (options.command === "help" || options.command === "--help" || options.command === "-h") {
  printHelp();
} else if (options.command === "status") {
  const current = status();
  if (current.unlocked) {
    console.log("unlocked — ready. next: secret list, or secret env --output .env");
  } else if (current.authenticated) {
    console.log('locked — unlock with: export BW_SESSION="$(bw unlock --raw)"');
  } else {
    console.log('unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"');
  }
} else if (options.command === "list") {
  const entries = Object.entries(loaded.definitions);
  for (const [alias, definition] of entries) {
    console.log(`${alias}\t${definition.item}\t${definition.field || "password"}`);
  }
  console.error(`secret: ${entries.length} aliases configured. next: secret get <alias>, or secret env --output .env`);
} else if (options.command === "get") {
  const alias = options.positional[0] || fail("get requires an alias, e.g. secret get github-token (see 'secret list')");
  const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias} (see 'secret list')`);
  console.log(getValue(alias, definition));
} else if (options.command === "env") {
  if (!loaded.selectedAliases?.length) {
    fail("env requires .secret.json or --config FILE with a secrets map; see docs/bitwarden.md");
  }
  const lines = loaded.selectedAliases.map((alias) => {
    const definition = loaded.definitions[alias] || fail(`unknown alias: ${alias}`);
    return `${dotenvKey(alias, definition)}=${dotenvValue(getValue(alias, definition))}`;
  });
  const output = `${lines.join("\n")}\n`;
  if (options.outputPath) {
    writeAtomic(options.outputPath, output);
    console.error(`secret: wrote ${lines.length} aliases to ${options.outputPath} (mode 0600)`);
  } else {
    process.stdout.write(output);
  }
} else {
  fail(`unknown command: ${options.command}`);
}
