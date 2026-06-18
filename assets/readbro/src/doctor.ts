import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CACHE_SCHEMA_VERSION, repoDbPath } from "./cache.ts";
import { findRepoRoot, isWorkingCopyRoot, workingCopyKind } from "./repo-root.ts";
import { openDatabase } from "./sqlite.ts";

export type DoctorCheckStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: DoctorCheckStatus;
  readonly detail: string;
  readonly fix?: string;
};

export type DoctorReport = {
  readonly checks: ReadonlyArray<DoctorCheck>;
  readonly ok: boolean;
};

export type DoctorOptions = {
  readonly anchorPath?: string;
};

const check = (
  id: string,
  label: string,
  status: DoctorCheckStatus,
  detail: string,
  fix?: string,
): DoctorCheck => ({ id, label, status, detail, fix });

const compostoPath = (): string | null => {
  const result = spawnSync("which", ["composto"], { encoding: "utf-8" });
  if (result.status !== 0) {
    return null;
  }
  const path = result.stdout.trim();
  return path.length > 0 ? path : null;
};

const compostoVersion = (binPath: string): string | null => {
  for (const args of [["--version"], ["version"]]) {
    const result = spawnSync(binPath, args, { encoding: "utf-8", timeout: 10_000 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0 && output.length > 0) {
      return output.split("\n")[0] ?? output;
    }
  }
  return null;
};

const probeCompostoIr = (): { readonly ok: boolean; readonly detail: string } => {
  const tmp = mkdtempSync(join(tmpdir(), "readbro-doctor-"));
  try {
    writeFileSync(join(tmp, ".git"), "gitdir: /dev/null\n");
    writeFileSync(join(tmp, "probe.ts"), "export const __readbroDoctorProbe = true;\n");
    const result = spawnSync("composto", ["ir", "probe.ts", "L1"], {
      cwd: tmp,
      encoding: "utf-8",
      timeout: 30_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0 && output.length > 0) {
      return { ok: true, detail: "L1 IR smoke probe succeeded" };
    }
    return {
      ok: false,
      detail: output.length > 0 ? output.split("\n")[0]! : `exit ${result.status ?? "unknown"}`,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

const probeCacheWritable = (cacheDir: string): { readonly ok: boolean; readonly detail: string } => {
  try {
    accessSync(cacheDir, constants.W_OK | constants.R_OK);
    const probe = join(cacheDir, `.write-probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
    return { ok: true, detail: `writable  ${cacheDir}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `not writable  ${cacheDir} (${message})` };
  }
};

const readCacheSchema = (dbPath: string): { readonly status: DoctorCheckStatus; readonly detail: string } => {
  if (!existsSync(dbPath)) {
    return { status: "ok", detail: `not created yet (will use schema v${CACHE_SCHEMA_VERSION})` };
  }

  const db = openDatabase(dbPath);
  try {
    const metaTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
      .get() as { name: string } | undefined;
    if (!metaTable) {
      return { status: "warn", detail: "database exists but schema_meta missing (will migrate on next read)" };
    }
    const versionRow = db
      .prepare("SELECT version FROM schema_meta LIMIT 1")
      .get() as { version: number } | undefined;
    const version = versionRow?.version;
    if (version === CACHE_SCHEMA_VERSION) {
      return { status: "ok", detail: `schema v${version}  ${dbPath}` };
    }
    if (version === undefined) {
      return { status: "warn", detail: `empty schema_meta in ${dbPath}` };
    }
    return {
      status: "fail",
      detail: `schema v${version}, expected v${CACHE_SCHEMA_VERSION}  ${dbPath}`,
    };
  } finally {
    db.close();
  }
};

export const runDoctor = (options: DoctorOptions = {}): DoctorReport => {
  const anchor = resolve(options.anchorPath ?? process.cwd());
  const checks: DoctorCheck[] = [];

  const bin = compostoPath();
  if (!bin) {
    checks.push(
      check(
        "composto",
        "composto",
        "fail",
        "not found on PATH",
        "Install composto or run `nix run nixpkgs#home-manager -- switch` so IR compression works.",
      ),
    );
  } else {
    const version = compostoVersion(bin);
    checks.push(
      check(
        "composto",
        "composto",
        "ok",
        version ? `${version} on PATH (${bin})` : `on PATH (${bin})`,
      ),
    );

    const ir = probeCompostoIr();
    checks.push(
      check(
        "composto_ir",
        "composto ir",
        ir.ok ? "ok" : "fail",
        ir.detail,
        ir.ok ? undefined : "Fix composto install or PATH; without IR, reads fall back to raw source.",
      ),
    );
  }

  let cacheDir: string;
  let dbPath: string;
  try {
    dbPath = repoDbPath(anchor);
    cacheDir = dirname(dbPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(
      check(
        "cache_dir",
        "cache dir",
        "fail",
        message,
        "Set READBRO_DIR to a writable directory or run from a git/jj working copy.",
      ),
    );
    dbPath = "";
    cacheDir = "";
  }

  if (cacheDir) {
    const writable = probeCacheWritable(cacheDir);
    checks.push(
      check(
        "cache_dir",
        "cache dir",
        writable.ok ? "ok" : "fail",
        writable.detail,
        writable.ok ? undefined : "Fix permissions or set READBRO_DIR to a writable path.",
      ),
    );

    const schema = readCacheSchema(dbPath);
    checks.push(
      check(
        "cache_schema",
        "cache db",
        schema.status,
        schema.detail,
        schema.status === "fail"
          ? "Run `readbro clear` to reset, or delete .readbro/cache.db manually."
          : undefined,
      ),
    );
  }

  const sessionEnv = process.env.READBRO_SESSION_ID;
  checks.push(
    check(
      "session_id",
      "session id",
      "ok",
      sessionEnv ? `${sessionEnv}  (READBRO_SESSION_ID)` : "(auto per process — set READBRO_SESSION_ID to pin)",
    ),
  );

  const repoRoot = findRepoRoot(anchor);
  if (isWorkingCopyRoot(repoRoot)) {
    const kind = workingCopyKind(repoRoot);
    checks.push(check("repo_root", "repo root", "ok", `${repoRoot}  (${kind})`));
  } else if (process.env.READBRO_DIR) {
    checks.push(
      check(
        "repo_root",
        "repo root",
        "warn",
        "not inside a git/jj working copy (using READBRO_DIR for cache)",
      ),
    );
  } else {
    checks.push(
      check(
        "repo_root",
        "repo root",
        "warn",
        "not inside a git/jj working copy — cache path may be ambiguous",
        "Run from a repo root or set READBRO_DIR.",
      ),
    );
  }

  const ok = !checks.some((row) => row.status === "fail");
  return { checks, ok };
};

const statusIcon = (status: DoctorCheckStatus): string => {
  switch (status) {
    case "ok":
      return "✓";
    case "warn":
      return "!";
    case "fail":
      return "✗";
  }
};

export const formatDoctor = (report: DoctorReport, json = false): string => {
  if (json) {
    return JSON.stringify(report, null, 2);
  }

  const lines = ["readbro doctor", ""];
  for (const row of report.checks) {
    lines.push(`${statusIcon(row.status)} ${row.label.padEnd(14)} ${row.detail}`);
    if (row.fix && row.status !== "ok") {
      lines.push(`  → ${row.fix}`);
    }
  }

  lines.push("");
  if (report.ok) {
    lines.push("All checks passed.");
  } else {
    const failed = report.checks.filter((row) => row.status === "fail").length;
    lines.push(`${failed} check${failed === 1 ? "" : "s"} failed — readbro may fall back to raw reads.`);
  }

  return lines.join("\n");
};

export const doctorExitCode = (report: DoctorReport): number => (report.ok ? 0 : 1);
