import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

type JsonObject = Record<string, unknown>;

const lockWaitMs = 120_000;
const patchStart = "# BEGIN NIX-MANAGED DSH PLUGINS";
const patchEnd = "# END NIX-MANAGED DSH PLUGINS";
const stateFilename = ".nixfiles-managed-plugins.json";
const profileInstallTimeoutMs = 180_000;
const logPrefix = "[nixfiles:dshWebProfile]";

export const resolveLocalSpec = (spec: string, sourceDirectory: string): string => {
  const protocol = ["link:", "file:"].find((prefix) => spec.startsWith(prefix));
  if (protocol === undefined) return spec;
  const target = spec.slice(protocol.length);
  return isAbsolute(target) ? spec : `${protocol}${resolve(sourceDirectory, target)}`;
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const readObject = (path: string): JsonObject => {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(value)) throw new Error(`${path} must contain a JSON object`);
  return value;
};

const ensureObject = (parent: JsonObject, key: string): unknown => {
  parent[key] ??= {};
  return parent[key];
};

const errorCode = (error: unknown): unknown => (isObject(error) ? error.code : undefined);

const processExited = (record: string): boolean => {
  const processId = Number.parseInt(record.split("\n")[0] ?? "", 10);
  if (!Number.isInteger(processId)) return false;
  try {
    process.kill(processId, 0);
    return false;
  } catch (error) {
    return errorCode(error) === "ESRCH";
  }
};

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

const takeOverExitedLock = (lockPath: string): boolean => {
  const record = readText(lockPath);
  if (record === undefined || !processExited(record)) return false;

  const claimPath = `${lockPath}.takeover-${createHash("sha256").update(record).digest("hex").slice(0, 16)}`;
  let claimDescriptor: number;
  try {
    claimDescriptor = openSync(claimPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }

  try {
    writeSync(claimDescriptor, `${process.pid}\n`);
    closeSync(claimDescriptor);
    const currentRecord = readText(lockPath);
    if (currentRecord !== record || !processExited(record)) return false;
    try {
      rmSync(lockPath);
    } catch {
      return false;
    }
    return true;
  } finally {
    rmSync(claimPath, { force: true });
  }
};

const withProfileLock = async <T,>(manifestPath: string, work: () => Promise<T>): Promise<T> => {
  const lockPath = `${manifestPath}.lock`;
  const deadline = Date.now() + lockWaitMs;
  let delayMs = 20;

  while (true) {
    let lockDescriptor: number;
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (takeOverExitedLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(`timed out waiting for DSH profile lock: ${lockPath}`);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 200);
      continue;
    }

    try {
      writeSync(lockDescriptor, `${process.pid}\n`);
      closeSync(lockDescriptor);
    } catch (error) {
      rmSync(lockPath, { force: true });
      throw error;
    }
    break;
  }

  try {
    return await work();
  } finally {
    rmSync(lockPath, { force: true });
  }
};

const atomicWrite = (path: string, content: string): void => {
  const mode = existsSync(path) ? statSync(path).mode & 0o7777 : 0o600;
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}`);
  try {
    const descriptor = openSync(temporaryPath, "wx", mode);
    try {
      fchmodSync(descriptor, mode);
      writeSync(descriptor, content);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1;

const reconcilePatch = (path: string, source: string): boolean => {
  if (countOccurrences(source, patchStart) !== 1 || countOccurrences(source, patchEnd) !== 1) {
    throw new Error("Nix Cordis patch must contain one managed plugin region");
  }
  const sourceStart = source.indexOf(patchStart);
  const region = source.slice(sourceStart, source.indexOf(patchEnd, sourceStart) + patchEnd.length);

  const target = readFileSync(path, "utf8");
  const starts = countOccurrences(target, patchStart);
  const ends = countOccurrences(target, patchEnd);
  let updated: string;

  if (starts === 1 && ends === 1) {
    const start = target.indexOf(patchStart);
    const end = target.indexOf(patchEnd, start) + patchEnd.length;
    updated = `${target.slice(0, start)}${region}${target.slice(end)}`;
  } else if (starts > 0 || ends > 0) {
    throw new Error(`${path} has an incomplete Nix-managed Cordis region`);
  } else {
    const legacyRegion = region.replace(`${patchStart}\n`, "").replace(`\n${patchEnd}`, "");
    if (target.includes(legacyRegion)) {
      updated = target.replace(legacyRegion, () => region);
    } else if (target.includes("id: dshfiles-multi-host")) {
      return false;
    } else {
      updated = `${target.trimEnd()}\n\n${region}\n`;
    }
  }

  if (updated === target) return false;
  atomicWrite(path, updated);
  return true;
};

const groupAlive = (processGroupId: number): boolean => {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
};

const signalGroup = (processGroupId: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
};

// The child leads its own process group so a timeout also reaches the
// grandchildren (zsh -> fnm -> pnpm) that would otherwise outlive it.
export const runBounded = async (options: {
  command: string[];
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  termGraceMs?: number;
  label: string;
}): Promise<void> => {
  const [executable, ...args] = options.command;
  if (executable === undefined) throw new Error("runBounded needs a command");
  const termGraceMs = options.termGraceMs ?? 5_000;
  const startedAt = Date.now();
  const elapsedSeconds = () => ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`${logPrefix} ${options.label} started.`);

  const child = spawn(executable, args, { env: options.environment, stdio: "inherit", detached: true });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal === null ? code : null));
  });
  const processGroupId = child.pid;
  if (processGroupId === undefined) {
    await exited;
    throw new Error(`${options.label} could not be started`);
  }

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
  });
  const outcome = await Promise.race([exited, timedOut]);
  clearTimeout(timer);

  if (outcome === "timeout") {
    signalGroup(processGroupId, "SIGTERM");
    const termDeadline = Date.now() + termGraceMs;
    while (groupAlive(processGroupId)) {
      if (Date.now() >= termDeadline) {
        signalGroup(processGroupId, "SIGKILL");
        break;
      }
      await sleep(50);
    }
    await exited;
    throw new Error(`${options.label} exceeded ${options.timeoutMs / 1000}s after ${elapsedSeconds()}s`);
  }

  if (outcome !== 0) {
    console.log(`${logPrefix} ${options.label} failed with status ${outcome} after ${elapsedSeconds()}s.`);
    throw new Error(`${options.label} failed with status ${outcome}`);
  }
  console.log(`${logPrefix} ${options.label} completed in ${elapsedSeconds()}s.`);
};

const installProfile = async (profile: string): Promise<void> => {
  const pnpmHome = join(homedir(), ".local/share/pnpm");
  await runBounded({
    command: [
      "/bin/zsh",
      "-lc",
      'fnm exec --using=v22.23.3 -- pnpm --dir "$1" install --prefer-offline',
      "dsh-profile-sync",
      profile,
    ],
    environment: {
      ...process.env,
      PNPM_HOME: pnpmHome,
      PNPM_STORE_DIR: join(pnpmHome, "store"),
      PATH: [join(pnpmHome, "bin"), pnpmHome, process.env.PATH ?? ""].join(delimiter),
    },
    timeoutMs: profileInstallTimeoutMs,
    label: "DSH web profile dependency install",
  });
};

const reconcile = async (options: { profile: string; sourceManifestPath: string; sourcePatchPath: string }) => {
  const manifestPath = join(options.profile, "package.json");
  const patchPath = join(options.profile, "cordis.patch.yml");
  const statePath = join(options.profile, stateFilename);
  const sourceManifest = readObject(options.sourceManifestPath);
  const sourcePatch = readFileSync(options.sourcePatchPath, "utf8");

  // The checkout's profile links plugins relative to its own folder, so resolve them to
  // absolute paths: the live profile sits elsewhere and the checkout can live anywhere.
  const sourceDependencies = sourceManifest.dependencies ?? {};
  const desiredDependencies = isObject(sourceDependencies)
    ? Object.fromEntries(
        Object.entries(sourceDependencies).map(([name, spec]) => [
          name,
          typeof spec === "string" ? resolveLocalSpec(spec, dirname(options.sourceManifestPath)) : spec,
        ]),
      )
    : sourceDependencies;
  const sourceDsh = sourceManifest.dsh ?? {};
  const sourceProfile = isObject(sourceDsh) ? (sourceDsh.profile ?? {}) : {};
  const desiredBundles = isObject(sourceProfile) ? (sourceProfile.bundles ?? []) : [];
  if (!isObject(desiredDependencies) || !Object.values(desiredDependencies).every((spec) => typeof spec === "string")) {
    throw new Error("Nix DSH dependencies must map package names to specs");
  }
  if (!isStringList(desiredBundles)) throw new Error("Nix DSH bundles must be a list of package names");

  await withProfileLock(manifestPath, async () => {
    const manifest = readObject(manifestPath);
    const currentDependencies = ensureObject(manifest, "dependencies");
    const currentDsh = ensureObject(manifest, "dsh");
    if (!isObject(currentDependencies) || !isObject(currentDsh)) {
      throw new Error("DSH profile dependencies and dsh settings must be objects");
    }
    const currentProfile = ensureObject(currentDsh, "profile");
    if (!isObject(currentProfile)) throw new Error("DSH profile settings must be an object");
    const currentBundles = ensureObject(currentProfile, "bundles");
    if (!isStringList(currentBundles)) throw new Error("DSH profile bundles must be a list of package names");

    const previousState = existsSync(statePath) ? readObject(statePath) : {};
    const previousDependencies = previousState.dependencies ?? {};
    const previousBundles = previousState.bundles ?? [];
    if (!isObject(previousDependencies) || !isStringList(previousBundles)) {
      throw new Error(`${statePath} has an invalid managed plugin record`);
    }

    for (const [name, previousSpec] of Object.entries(previousDependencies)) {
      if (!Object.hasOwn(desiredDependencies, name) && currentDependencies[name] === previousSpec) {
        delete currentDependencies[name];
      }
    }
    const staleBundles = new Set(previousBundles.filter((bundle) => !desiredBundles.includes(bundle)));
    const keptBundles = currentBundles.filter((bundle) => !staleBundles.has(bundle));
    Object.assign(currentDependencies, desiredDependencies);
    currentProfile.bundles = [...keptBundles, ...desiredBundles.filter((bundle) => !keptBundles.includes(bundle))];

    const manifestChanged = !isDeepStrictEqual(manifest, readObject(manifestPath));
    if (manifestChanged) atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const patchChanged = reconcilePatch(patchPath, sourcePatch);
    const newState = { dependencies: desiredDependencies, bundles: desiredBundles };
    const stateChanged = !isDeepStrictEqual(newState, previousState);
    if (manifestChanged || stateChanged || !existsSync(statePath)) {
      console.log("Installing the reconciled DSH web profile plugins.");
      await installProfile(options.profile);
    }
    if (patchChanged) console.log("Restored the Nix-managed DSH Cordis plugin entries.");
    if (stateChanged) atomicWrite(statePath, `${JSON.stringify(newState, null, 2)}\n`);
  });
};

if (import.meta.main) {
  const [profile, sourceManifestPath, sourcePatchPath] = process.argv.slice(2);
  if (profile === undefined || sourceManifestPath === undefined || sourcePatchPath === undefined) {
    console.error("usage: sync-web-profile.mts <profile> <source-package.json> <source-cordis.patch.yml>");
    process.exit(2);
  }
  await reconcile({ profile, sourceManifestPath, sourcePatchPath });
}
