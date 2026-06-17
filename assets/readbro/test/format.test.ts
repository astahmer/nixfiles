import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";
import { formatGain, formatStats } from "../src/format.ts";
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

test("stats separate layers and show raw vs billed totals", () => {
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
  cache.readFile(file, { layer: "L3" });
  cache.readFile(file, { layer: "L3" });

  const repoStats = cache.getStats({ anchorPath: repo, scope: "repo" });
  assert.equal(repoStats.byLayer.length, 2);
  assert.ok(repoStats.rawTokens > repoStats.billedTokens);
  assert.ok(repoStats.savedTokens > 0);
  assert.ok(repoStats.totalDurationMs >= 0);
  assert.ok(repoStats.byRepresentation.length >= 1);

  const sessionStats = cache.getStats({ anchorPath: repo, scope: "session" });
  assert.equal(sessionStats.scope, "session");
  assert.equal(sessionStats.sessionId, "test-session");
  assert.equal(sessionStats.totalReads, 4);

  const summary = formatStats(repoStats);
  assert.match(summary, /Raw tokens/);
  assert.match(summary, /Total IR time/);
  assert.match(summary, /By Layer/);
  assert.match(summary, /By Representation/);

  const gain = formatGain(repoStats);
  assert.match(gain, /By File/);
  assert.match(gain, /Recent Reads/);
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

rmSync(tmp, { recursive: true, force: true });
