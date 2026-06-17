import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";
import { formatGain, formatStats, formatStatsJson } from "../src/format.ts";
import { formatSinceLabel, parseSince } from "../src/stats-query.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-format-"));

test("parseSince accepts day/hour/minute durations", () => {
  assert.equal(parseSince("7d"), 7 * 86_400_000);
  assert.equal(parseSince("24h"), 24 * 3_600_000);
  assert.equal(parseSince("30m"), 30 * 60_000);
});

test("formatSinceLabel renders readable windows", () => {
  assert.equal(formatSinceLabel(7 * 86_400_000), "7d");
  assert.equal(formatSinceLabel(3_600_000), "1h");
});

test("default stats is summary-only and gain shows top files with full paths", () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "layered.ts");
  writeFileSync(
    file,
    `${"export const value = 1;\n".repeat(80)}export const tail = true;\n`,
  );

  const db = join(tmp, "layers.db");
  const cache = new IrCacheStore({ dbPath: db, sessionId: "test-session" });

  cache.readFile(file, { layer: "L1" });
  cache.readFile(file, { layer: "L1" });

  const repoStats = cache.getStats({ anchorPath: repo, scope: "repo" });
  const summary = formatStats(repoStats);
  assert.match(summary, /Raw tokens/);
  assert.doesNotMatch(summary, /By Layer/);
  assert.doesNotMatch(summary, /By Representation/);

  const verboseStats = formatStats(repoStats, { verbose: true });
  assert.match(verboseStats, /By Layer/);
  assert.match(verboseStats, /By Representation/);

  const gain = formatGain(repoStats);
  assert.match(gain, /Top Files/);
  assert.match(gain, /layered\.ts/);
  assert.doesNotMatch(gain, /Recent Reads/);

  const json = JSON.parse(formatStatsJson(repoStats)) as { totalReads: number };
  assert.equal(json.totalReads, 2);
});

test("since filter limits stats to recent reads", () => {
  const repo = join(tmp, "repo-since");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "since.ts");
  writeFileSync(file, `${"export const since = true;\n".repeat(50)}`);

  const db = join(tmp, "since.db");
  const cache = new IrCacheStore(db);
  cache.readFile(file, { layer: "L1" });

  const all = cache.getStats({ anchorPath: repo, scope: "repo" });
  const none = cache.getStats({ anchorPath: repo, scope: "repo", sinceMs: 1 });

  assert.equal(all.totalReads, 1);
  assert.equal(none.totalReads, 0);
});

test("glob filter, discover-globs, and hit rate", () => {
  const repo = join(tmp, "repo-glob");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  mkdirSync(join(repo, "assets", "readbro", "src"), { recursive: true });
  mkdirSync(join(repo, "modules"), { recursive: true });

  const readbroFile = join(repo, "assets", "readbro", "src", "app.ts");
  const moduleFile = join(repo, "modules", "shell.nix");
  const payload = `${"export const x = 1;\n".repeat(40)}`;
  writeFileSync(readbroFile, payload);
  writeFileSync(moduleFile, payload);

  const db = join(tmp, "glob.db");
  const cache = new IrCacheStore(db);
  cache.readFile(readbroFile, { layer: "L1" });
  cache.readFile(readbroFile, { layer: "L1" });
  cache.readFile(moduleFile, { layer: "L1" });

  const filtered = cache.getStats({
    anchorPath: repo,
    glob: "assets/**/*.ts",
  });
  assert.equal(filtered.totalReads, 2);
  assert.equal(filtered.byGlob[0]?.pattern, "assets/**/*.ts");
  assert.equal(filtered.byGlob[0]?.cacheHits, 1);
  assert.equal(filtered.byGlob[0]?.fullReads, 1);

  const discovered = cache.getStats({
    anchorPath: repo,
    discoverGlobs: 3,
  });
  assert.ok((discovered.discoveredGlobs?.length ?? 0) > 0);
  assert.ok(discovered.byGlob.length > 0);
  assert.ok(discovered.byGlob[0]?.hitRatePct !== undefined);

  const grouped = cache.getStats({
    anchorPath: repo,
    groupGlobs: ["assets/**", "modules/**"],
  });
  assert.equal(grouped.byGlob.length, 2);
  assert.ok(grouped.byGlob.some((row) => row.pattern === "assets/**"));
  assert.ok(grouped.byGlob.some((row) => row.pattern === "modules/**"));
});

rmSync(tmp, { recursive: true, force: true });
