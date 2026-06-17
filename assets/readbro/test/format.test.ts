import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";
import { formatGain, formatStats, formatTokenCount } from "../src/format.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-format-"));

test("formatTokenCount abbreviates large values", () => {
  assert.equal(formatTokenCount(95500), "95.5K");
  assert.equal(formatTokenCount(32100), "32.1K");
  assert.equal(formatTokenCount(512), "512");
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
  const cache = new IrCacheStore(db);

  cache.readFile(file, { layer: "L1" });
  cache.readFile(file, { layer: "L1" });
  cache.readFile(file, { layer: "L3" });
  cache.readFile(file, { layer: "L3" });

  const stats = cache.getStats(repo);
  assert.equal(stats.byLayer.length, 2);
  assert.ok(stats.rawTokens > stats.billedTokens);
  assert.ok(stats.savedTokens > 0);
  assert.equal(stats.savedPct, (stats.savedTokens / stats.rawTokens) * 100);

  const summary = formatStats(stats);
  assert.match(summary, /Raw tokens/);
  assert.match(summary, /Billed tokens/);
  assert.match(summary, /By Layer/);
  assert.match(summary, /L1/);
  assert.match(summary, /L3/);

  const gain = formatGain(stats);
  assert.match(gain, /By File/);
  assert.match(gain, /Recent Reads/);
});

rmSync(tmp, { recursive: true, force: true });
