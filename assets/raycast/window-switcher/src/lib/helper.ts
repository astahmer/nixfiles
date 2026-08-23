import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

interface ListResult {
  windows: WinInfo[];
  titlesEmpty: boolean;
}

const SRC = path.join(environment.assetsPath, "winlist.swift");
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
      const hash = createHash("sha256").update(readFileSync(SRC)).digest("hex");
      if (existsSync(BIN) && existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === hash) {
        return BIN;
      }
      await new Promise<void>((resolve, reject) => {
        execFile("swiftc", [SRC, "-o", BIN], (err, _stdout, stderr) => {
          if (err) {
            helperPromise = null;
            reject(new Error(`swiftc failed (is the Xcode CLT installed?): ${stderr.slice(0, 400)}`));
            return;
          }
          resolve();
        });
      });
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
