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

export async function focusWindow(win: WinInfo): Promise<string> {
  const bin = await ensureHelper();
  return run(bin, ["focus", String(win.pid), String(win.cgid), win.title]);
}
