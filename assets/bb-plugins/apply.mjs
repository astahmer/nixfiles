import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const setup = JSON.parse(readFileSync(process.env.BB_SETUP_CONFIG, "utf8"));
const pluginRoot = process.env.BB_PLUGIN_ROOT;
const bbCli = process.env.BB_CLI ?? "bb";

mkdirSync(pluginRoot, { recursive: true });

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });

const bb = (args, options = {}) => run(bbCli, args, options);

const sourceFor = (pluginId) => {
  try {
    const output = execFileSync(bbCli, ["plugin", "source", pluginId, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output).requested;
  } catch {
    return null;
  }
};

for (const plugin of setup.customPlugins) {
  const pluginDirectory = join(pluginRoot, plugin.id);
  run("rsync", [
    "-a",
    "--delete",
    "--exclude=node_modules",
    "--exclude=dist",
    "--exclude=.bb-dependencies-hash",
    `${plugin.source}/`,
    `${pluginDirectory}/`,
  ]);

  const npmLock = join(pluginDirectory, "package-lock.json");
  const pnpmLock = join(pluginDirectory, "pnpm-lock.yaml");
  const dependencyFiles = [join(pluginDirectory, "package.json")];
  if (existsSync(npmLock)) dependencyFiles.push(npmLock);
  if (existsSync(pnpmLock)) dependencyFiles.push(pnpmLock);
  const dependencyHash = createHash("sha256")
    .update(dependencyFiles.map((path) => readFileSync(path)).join("\0"))
    .digest("hex");
  const dependencyStamp = join(pluginDirectory, ".bb-dependencies-hash");
  const dependenciesChanged =
    !existsSync(join(pluginDirectory, "node_modules")) ||
    !existsSync(dependencyStamp) ||
    readFileSync(dependencyStamp, "utf8") !== dependencyHash;

  if (dependenciesChanged && existsSync(npmLock)) {
    run("npm", ["ci", "--no-audit", "--no-fund", "--silent"], { cwd: pluginDirectory });
  } else if (dependenciesChanged && existsSync(pnpmLock)) {
    run("pnpm", ["install", "--frozen-lockfile", "--silent"], { cwd: pluginDirectory });
  } else if (dependenciesChanged) {
    run("npm", ["install", "--no-audit", "--no-fund", "--silent"], { cwd: pluginDirectory });
  }
  writeFileSync(dependencyStamp, dependencyHash);

  bb(["plugin", "build"], { cwd: pluginDirectory });
  const installedSource = sourceFor(plugin.id);
  const targetSource = `path:${pluginDirectory}`;

  if (installedSource === targetSource) {
    bb(["plugin", "reload", plugin.id]);
  } else {
    bb(["plugin", "install", targetSource, "--yes"]);
  }

  bb(["plugin", plugin.enabled ? "enable" : "disable", plugin.id]);
}

for (const plugin of setup.thirdPartyPlugins) {
  if (sourceFor(plugin.id) === null) bb(["plugin", "install", plugin.source, "--yes"]);
  bb(["plugin", plugin.enabled ? "enable" : "disable", plugin.id]);
}

for (const [key, value] of Object.entries(setup.generalSettings)) {
  bb([
    "settings",
    "general",
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
}

for (const [key, value] of Object.entries(setup.uiSettings)) {
  bb([
    "settings",
    "ui",
    "set",
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  ]);
}

for (const shortcut of setup.shortcuts) {
  bb(["settings", "keyboard", "set", shortcut.command, shortcut.value]);
}

for (const plugin of setup.pluginSettings) {
  for (const [key, value] of Object.entries(plugin.values)) {
    bb([
      "plugin",
      "config",
      plugin.id,
      "set",
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]);
  }
}
