import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { environment } from "@raycast/api";

export interface WinInfo {
  owner: string;
  pid: number;
  cgid: number;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onscreen: boolean;
  path: string;
}

export interface ListResult {
  windows: WinInfo[];
  untitled: number;
  total: number;
}

// environment.assetsPath can be a STALE internal copy kept by Raycast from
// the first develop run — pick the newest winlist.swift among known locations.
const SRC_CANDIDATES = [
  path.join(environment.assetsPath, "winlist.swift"),
  path.join(os.homedir(), "RaycastExtensions", "window-switcher", "assets", "winlist.swift"),
];
function latestSrc(): string {
  const found = SRC_CANDIDATES.filter(existsSync);
  if (found.length === 0) throw new Error(`winlist.swift not found in ${SRC_CANDIDATES.join(", ")}`);
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
const CACHE_DIR = path.join(os.homedir(), "Library", "Caches", "dev.nixfiles.window-switcher");
const BIN = path.join(CACHE_DIR, "winlist");
const STAMP = path.join(CACHE_DIR, "stamp.sha256");

let helperPromise: Promise<string> | null = null;

/**
 * Compile the Swift helper once and cache it keyed by the source hash.
 * First ever invocation takes ~10-30s (swiftc); afterwards ~50ms.
 */
function ensureHelper(): Promise<string> {
  if (!helperPromise) {
    helperPromise = (async () => {
      mkdirSync(CACHE_DIR, { recursive: true });
      const SRC = latestSrc();
      const hash = createHash("sha256").update(readFileSync(SRC)).digest("hex");
      const stampOk =
        existsSync(BIN) && existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === hash;
      if (stampOk && readFileSync(BIN).includes("ws-diag")) {
        return BIN;
      }
      const tmpOut = `${BIN}.tmp-${process.pid}`;
      await new Promise<void>((resolve, reject) => {
        execFile("swiftc", [SRC, "-o", tmpOut], (err, _stdout, stderr) => {
          if (err) {
            helperPromise = null;
            reject(new Error(`swiftc failed (is the Xcode CLT installed?): ${stderr.slice(0, 400)}`));
            return;
          }
          resolve();
        });
      });
      // atomic swap so concurrent/old readers never see a half-written binary
      renameSync(tmpOut, BIN);
      if (!readFileSync(BIN).includes("ws-diag")) {
        helperPromise = null;
        throw new Error("helper build verification failed");
      }
      writeFileSync(STAMP, `${hash}\n`);
      return BIN;
    })();
  }
  return helperPromise;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim().slice(0, 400) || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function listWindows(): Promise<ListResult> {
  const bin = await ensureHelper();
  return JSON.parse(await run(bin, ["list"]));
}

// --- stale-while-revalidate listing ---------------------------------------
// The node process lives across command invocations, so we keep the last
// snapshot: opening the command renders instantly from cache while a fresh
// scan runs in the background.
let listCache: { at: number; data: ListResult } | null = null;
let listInflight: Promise<ListResult> | null = null;

export interface ListSnapshot {
  data: ListResult;
  ageMs: number;
}

export async function listWindowsCached(maxAgeMs = 1500): Promise<ListSnapshot> {
  if (listCache && Date.now() - listCache.at < maxAgeMs) {
    return { data: listCache.data, ageMs: Date.now() - listCache.at };
  }
  if (!listInflight) {
    listInflight = listWindows()
      .then((data) => {
        listCache = { at: Date.now(), data };
        listInflight = null;
        return data;
      })
      .catch((err) => {
        listInflight = null;
        throw err;
      });
  }
  const data = await listInflight;
  return { data, ageMs: listCache ? Date.now() - listCache.at : 0 };
}

export function peekListCache(): ListResult | null {
  return listCache?.data ?? null;
}

export async function focusWindow(win: WinInfo): Promise<string> {
  const bin = await ensureHelper();
  return run(bin, ["focus", String(win.pid), String(win.cgid), win.title]);
}

// --- herdr integration (socket API via CLI) --------------------------------

export interface HerdrWorkspace {
  workspace_id: string;
  label: string;
  focused?: boolean;
}

function herdrCandidates(): string[] {
  const home = os.homedir();
  return [
    ...(process.env.HERDR_BIN ? [process.env.HERDR_BIN] : []),
    // official installer default
    path.join(home, ".local", "bin", "herdr"),
    // homebrew (apple silicon + intel)
    "/opt/homebrew/bin/herdr",
    "/usr/local/bin/herdr",
    // nix
    path.join(home, ".nix-profile", "bin", "herdr"),
    "/run/current-system/sw/bin/herdr",
    // mise shims
    path.join(home, ".local", "share", "mise", "shims", "herdr"),
    // cargo
    path.join(home, ".cargo", "bin", "herdr"),
    "herdr",
  ];
}

let herdrBinPromise: Promise<string | null> | null = null;

function resolveHerdr(): Promise<string | null> {
  if (!herdrBinPromise) {
    herdrBinPromise = new Promise((resolve) => {
      const candidates = herdrCandidates();
      let i = 0;
      const next = () => {
        if (i >= candidates.length) return resolve(null);
        const c = candidates[i++];
        execFile(c, ["workspace", "list"], { timeout: 4000 }, (err) => {
          if (err) next();
          else resolve(c);
        });
      };
      next();
    });
  }
  return herdrBinPromise;
}

export async function herdrWorkspaces(): Promise<HerdrWorkspace[] | null> {
  const bin = await resolveHerdr();
  if (!bin) return null;
  return new Promise((resolve) => {
    execFile(bin, ["workspace", "list"], { maxBuffer: 4 * 1024 * 1024, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const parsed = JSON.parse(stdout.toString());
        resolve(parsed?.result?.workspaces ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function herdrFocusWorkspace(id: string): Promise<boolean> {
  const bin = await resolveHerdr();
  if (!bin) return false;
  return new Promise((resolve) => {
    execFile(bin, ["workspace", "focus", id], { timeout: 4000 }, (err) => resolve(!err));
  });
}
