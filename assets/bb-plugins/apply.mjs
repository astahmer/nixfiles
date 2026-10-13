import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const setup = JSON.parse(readFileSync(process.env.BB_SETUP_CONFIG, "utf8"));
const pluginRoot = process.env.BB_PLUGIN_ROOT;
const bbCli = process.env.BB_CLI ?? "bb";
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const INSTALL_COMMAND_TIMEOUT_MS = 120_000;

mkdirSync(pluginRoot, { recursive: true });

const run = (command, args, options = {}) => {
  const {
    label = command,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    ...execOptions
  } = options;
  const startedAt = Date.now();
  console.error(`[nixfiles:installBbPlugins] ${label} started`);
  try {
    const output = execFileSync(command, args, {
      stdio: "inherit",
      timeout: timeoutMs,
      ...execOptions,
    });
    console.error(
      `[nixfiles:installBbPlugins] ${label} completed in ${Date.now() - startedAt}ms`,
    );
    return output;
  } catch (error) {
    const status = error.status ?? error.code ?? error.signal ?? "unknown";
    console.error(
      `[nixfiles:installBbPlugins] ${label} failed after ${Date.now() - startedAt}ms (status ${status})`,
    );
    throw new Error(`[nixfiles:installBbPlugins] ${label} failed (status ${status})`);
  }
};

const bb = (args, options = {}) =>
  run(bbCli, args, {
    label: `bb ${args.slice(0, 3).join(" ")}`,
    ...options,
  });

const sourceFor = (pluginId) => {
  const startedAt = Date.now();
  console.error(`[nixfiles:installBbPlugins] ${pluginId} source lookup started`);
  try {
    const output = execFileSync(bbCli, ["plugin", "source", pluginId, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    return JSON.parse(output).requested;
  } catch (error) {
    if (error.killed || error.signal) {
      throw new Error(
        `[nixfiles:installBbPlugins] ${pluginId} source lookup timed out after ${Date.now() - startedAt}ms`,
      );
    }
    return null;
  } finally {
    console.error(
      `[nixfiles:installBbPlugins] ${pluginId} source lookup finished in ${Date.now() - startedAt}ms`,
    );
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
  ], { label: `${plugin.id} source sync`, timeoutMs: 60_000 });

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
    run(
      "npm",
      ["ci", "--no-audit", "--no-fund", "--silent", "--prefer-offline"],
      {
        cwd: pluginDirectory,
        label: `${plugin.id} dependency install`,
        timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      },
    );
  } else if (dependenciesChanged && existsSync(pnpmLock)) {
    run(
      "pnpm",
      ["install", "--frozen-lockfile", "--silent", "--prefer-offline"],
      {
        cwd: pluginDirectory,
        label: `${plugin.id} dependency install`,
        timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      },
    );
  } else if (dependenciesChanged) {
    run(
      "npm",
      ["install", "--no-audit", "--no-fund", "--silent", "--prefer-offline"],
      {
        cwd: pluginDirectory,
        label: `${plugin.id} dependency install`,
        timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
      },
    );
  }
  writeFileSync(dependencyStamp, dependencyHash);

  bb(["plugin", "build"], {
    cwd: pluginDirectory,
    label: `${plugin.id} build`,
  });
  const installedSource = sourceFor(plugin.id);
  const targetSource = `path:${pluginDirectory}`;

  if (installedSource === targetSource) {
    bb(["plugin", "reload", plugin.id], {
      label: `${plugin.id} reload`,
    });
  } else {
    bb(["plugin", "install", targetSource, "--yes"], {
      label: `${plugin.id} install`,
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
    });
  }

  bb(["plugin", plugin.enabled ? "enable" : "disable", plugin.id], {
    label: `${plugin.id} ${plugin.enabled ? "enable" : "disable"}`,
  });
}

for (const plugin of setup.thirdPartyPlugins) {
  if (sourceFor(plugin.id) === null) {
    bb(["plugin", "install", plugin.source, "--yes"], {
      label: `${plugin.id} install`,
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
    });
  }
  bb(["plugin", plugin.enabled ? "enable" : "disable", plugin.id], {
    label: `${plugin.id} ${plugin.enabled ? "enable" : "disable"}`,
  });
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
