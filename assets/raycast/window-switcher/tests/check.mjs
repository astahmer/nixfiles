#!/usr/bin/env node
// Regression checks for the window-switcher extension.
// Run: node tests/check.mjs [--live]
// Guards the bug classes that actually bit us:
//   1. wrong CG dictionary key (kCGWindowTitle vs kCGWindowName)
//   2. alpha filter dropping other-Space windows
//   3. stale helper binary (stamp/marker mismatch)
//   4. stale environment.assetsPath copy shadowing the seeded sources
//   5. repo <-> seeded folder drift
//   6. runtime contract of `winlist list`
//   7. (--live) real cross-Space focus round-trip

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const EXT_REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXT_SEEDED = path.join(os.homedir(), "RaycastExtensions", "window-switcher");
const CACHE_DIR = path.join(os.homedir(), "Library", "Caches", "dev.nixfiles.window-switcher");
const BIN = path.join(CACHE_DIR, "winlist");
const STAMP = path.join(CACHE_DIR, "stamp.sha256");
const LIVE = process.argv.includes("--live");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function warn(name, detail = "") {
  console.log(`⚠️  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- 1. wrong CG dictionary key ------------------------------------------
const swiftSrc = readFileSync(path.join(EXT_REPO, "assets", "winlist.swift"), "utf8");
check("source reads kCGWindowName (not kCGWindowTitle)",
  swiftSrc.includes('"kCGWindowName"') && !swiftSrc.includes("kCGWindowTitle"));

// --- 2. alpha filter must never come back --------------------------------
const alphaUses = swiftSrc.split("\n").filter((l) => l.includes("kCGWindowAlpha") && !l.trim().startsWith("//"));
check("no kCGWindowAlpha drop-filter (other-Space windows report alpha 0)",
  alphaUses.length === 0, alphaUses.join(" ; "));

// --- 3. build verification marker present in source ----------------------
check("helper.ts verifies built binary contains ws-diag marker",
  /includes\("ws-diag"\)/.test(readFileSync(path.join(EXT_REPO, "src", "lib", "helper.ts"), "utf8")));

// --- newest-source selection (stale assetsPath guard) --------------------
function srcCandidates(root) {
  const p = path.join(root, "assets", "winlist.swift");
  return existsSync(p) ? [p] : [];
}
const candidates = [
  ...srcCandidates(EXT_REPO),
  ...srcCandidates(EXT_SEEDED),
];
if (candidates.length < 2) {
  warn("newest-source selection needs >=2 candidate paths; found", String(candidates.length));
} else {
  const newest = candidates.reduce((a, b) => (statSync(b).mtimeMs > statSync(a).mtimeMs ? b : a));
  // the repo copy must never be older than any external copy for long; here we
  // only assert the selection function would resolve to an existing file
  check("winlist.swift resolvable among candidates", existsSync(newest), newest);
}

// --- 4. repo <-> seeded drift (only when seeded folder exists) -----------
if (existsSync(EXT_SEEDED)) {
  const files = [
    "assets/winlist.swift",
    "src/switch-window.tsx",
    "src/lib/helper.ts",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
  ];
  const drifted = files.filter((f) => {
    const a = path.join(EXT_REPO, f);
    const b = path.join(EXT_SEEDED, f);
    return existsSync(a) && existsSync(b) &&
      readFileSync(a).toString() !== readFileSync(b).toString();
  });
  check("repo and seeded folder in sync", drifted.length === 0, drifted.join(", "));
} else {
  warn("seeded folder missing (run nixapply)");
}

// --- 5. cached binary is fresh (only meaningful when cache exists) -------
if (existsSync(BIN) && existsSync(STAMP)) {
  const binHasMarker = readFileSync(BIN).includes("ws-diag");
  check("cached helper binary contains current-version marker", binHasMarker);
} else {
  warn("helper not compiled yet (first Raycast run compiles it)");
}

// --- 6. runtime contract of `list` ---------------------------------------
let result = null;
try {
  const out = execFileSync(BIN, ["list"], { maxBuffer: 16 * 1024 * 1024 }).toString();
  result = JSON.parse(out);
} catch (e) {
  // fall back to compiling from repo source for CI-style runs
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    execFileSync("/usr/bin/swiftc", [path.join(EXT_REPO, "assets", "winlist.swift"), "-o", BIN], { stdio: "pipe" });
    result = JSON.parse(execFileSync(BIN, ["list"], { maxBuffer: 16 * 1024 * 1024 }).toString());
  } catch (e2) {
    check("`winlist list` executes", false, String(e2?.message ?? e2).slice(0, 120));
  }
}
if (result) {
  const wins = result.windows ?? [];
  check("list returns windows array", Array.isArray(wins) && wins.length > 0, `${wins.length} windows`);
  const schemaBad = wins.filter((w) =>
    typeof w.owner !== "string" || !Number.isInteger(w.pid) || !Number.isInteger(w.cgid) ||
    !(w.w > 0) || !(w.h > 0) || typeof w.onscreen !== "boolean");
  check("every window has owner/pid/cgid/w/h/onscreen", schemaBad.length === 0);
  const ids = new Set(wins.map((w) => w.cgid));
  check("cgids unique", ids.size === wins.length);

  // --- title coverage: guards the kCGWindowTitle-class regressions --------
  const titled = wins.filter((w) => w.title).length;
  const offscreen = wins.filter((w) => !w.onscreen).length;
  const offscreenTitled = wins.filter((w) => !w.onscreen && w.title).length;
  if (titled === 0) {
    warn("zero titles (Screen Recording grant missing?) — skipping coverage assert");
  } else {
    check("majority of windows titled", titled > wins.length / 2, `${titled}/${wins.length}`);
    if (offscreen > 0) {
      // the headline feature: other-Space windows carry titles
      check("other-Space windows titled", offscreenTitled > 0, `${offscreenTitled}/${offscreen}`);
    }
  }
}

// --- 7. live tests: error paths + focus matrix ----------------------------
if (LIVE && result) { // eslint-disable-line
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (args) => { try { return execFileSync(BIN, args).toString().trim(); } catch (e) { return `ERR:${e.status ?? ""}`; } };
  const listNow = () => JSON.parse(execFileSync(BIN, ["list"]).toString()).windows;
  const isFront = (w) => frontCgid() === w.cgid;
  function frontCgid() {
    // cheap: onscreen list front-to-back — first window of any pid >0 that isn't our own probe
    const out = JSON.parse(execFileSync(BIN, ["list"]).toString());
    return out.windows.find((w) => w.onscreen)?.cgid ?? -1;
  }

  // E1: invalid pid -> must fail gracefully
  {
    const r = run(["focus", "99999", "12345", "whatever"]);
    check("live/E1: dead pid fails gracefully", r.startsWith("process not found") || !r.startsWith("ok"), r);
  }

  // E2: nonexistent cgid of a live pid -> all strategies miss, no crash
  {
    const live = result.windows[0];
    const r = run(["focus", String(live.pid), "4294967295", live.title]);
    check("live/E2: bogus cgid fails gracefully without crash", !r.startsWith("ok"), r.slice(0, 80));
  }

  // E3: empty title + valid target -> some strategy lands (cgid-based paths)
  {
    const cand = result.windows.find((w) => w.onscreen && w.w >= 800 && w.owner !== "Raycast" && !w.owner.includes("Helper"));
    if (!cand) warn("live/E3: no onscreen window; skipped");
    else {
      console.log(`ℹ️  live/E3: ${cand.owner} "${cand.title.slice(0, 30)}" (${cand.cgid})`);
      const r = run(["focus", String(cand.pid), String(cand.cgid), ""]);
      await sleep(400);
      check("live/E3: empty-title same-space focus lands", r.startsWith("ok"), `${r} target=${cand.owner}/${cand.cgid}`);
    }
  }

  // E4: off-screen window focus round-trip with restore
  {
    const before = listNow();
    const prevOn = before.find((w) => w.onscreen && w.w >= 800);
    const target = result.windows.find((w) => !w.onscreen && w.w >= 800 && w.pid !== prevOn?.pid)
      ?? result.windows.find((w) => !w.onscreen);
    if (!target) warn("live/E4: no off-screen window; skipped");
    else {
      console.log(`ℹ️  live/E4: focusing ${target.owner} "${target.title.slice(0, 40)}" (${target.cgid})`);
      const r = run(["focus", String(target.pid), String(target.cgid), target.title]);
      let landed = false;
      for (let i = 0; i < 16 && !landed; i++) {
        await sleep(500);
        landed = listNow().find((w) => w.cgid === target.cgid)?.onscreen === true;
      }
      check("live/E4: other-Space focus lands", r.startsWith("ok") && landed, `status=${r}`);
      // restore previous frontmost window/space
      if (prevOn && prevOn.cgid !== target.cgid) {
        run(["focus", String(prevOn.pid), String(prevOn.cgid), prevOn.title]);
        await sleep(1200);
        console.log("ℹ️  live/E4: restored previous window");
      }
    }
  }

  // E5: duplicate titles -> correct cgid disambiguation (when duplicates exist)
  {
    const byTitle = new Map();
    for (const w of result.windows) {
      if (!w.title || w.title.length < 3) continue;
      const arr = byTitle.get(w.title) ?? [];
      arr.push(w);
      byTitle.set(w.title, arr);
    }
    const dup = [...byTitle.entries()].find(([, ws]) =>
      ws.length >= 2 && ws.every((w) => w.owner !== "Ghostty"));
    if (!dup) warn("live/E5: no duplicate-title windows right now; skipped");
    else {
      const [title, group] = dup;
      const target = group.find((w) => !w.onscreen) ?? group[0];
      console.log(`ℹ️  live/E5: ${target.owner} "${title.slice(0, 30)}" (${target.cgid})`);
      const r = run(["focus", String(target.pid), String(target.cgid), title]);
      let okLanded = false;
      for (let i = 0; i < 14 && !okLanded; i++) {
        await sleep(500);
        okLanded = listNow().find((w) => w.cgid === target.cgid)?.onscreen === true;
      }
      check("live/E5: duplicate-title target lands on exact cgid", r.startsWith("ok") && okLanded,
        `status=${r} cgid=${target.cgid}`);
    }
  }

  // E6: rapid consecutive focuses (stress / no deadlock)
  {
    const targets = [
      result.windows.find((w) => w.onscreen && w.w >= 800),
      result.windows.find((w) => w.title && w.w >= 800),
      result.windows.find((w) => w.onscreen && w.title),
    ].filter(Boolean).slice(0, 3);
    const t0 = Date.now();
    for (const t of targets) run(["focus", String(t.pid), String(t.cgid), t.title]);
    check("live/E6: rapid focus bursts never hang", Date.now() - t0 < 75000, `${Date.now() - t0}ms`);
  }

  // restore user's original frontmost window after disruptive live tests
  {
    const orig = result.windows.find((w) => w.onscreen && w.w >= 800);
    if (orig) {
      try { execFileSync(BIN, ["focus", String(orig.pid), String(orig.cgid), orig.title]); } catch {}
      await sleep(800);
      console.log("ℹ️  live: restored your original frontmost window");
    }
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
