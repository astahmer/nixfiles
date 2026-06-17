import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.mjs";

const tmp = mkdtempSync(join(tmpdir(), "readbro-"));
const dbPath = join(tmp, "cache.db");

test("IR cache: first read full, second unchanged, third diff after edit", () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "sample.ts");
  writeFileSync(file, "export const answer = 1;\n");

  const cache = new IrCacheStore(dbPath);

  const r1 = cache.readFile(file, { layer: "L1" });
  assert.equal(r1.cached, false);
  assert.ok(r1.content.length > 0);

  const r2 = cache.readFile(file, { layer: "L1" });
  assert.equal(r2.cached, true);
  assert.equal(r2.linesChanged, 0);
  assert.match(r2.content, /unchanged IR/);

  writeFileSync(file, "export const answer = 2;\nexport const extra = true;\n");
  const r3 = cache.readFile(file, { layer: "L1" });
  assert.equal(r3.cached, true);
  assert.ok(r3.linesChanged > 0 || r3.diff);
});

test("repo cache shared across separate store instances", () => {
  const repo = join(tmp, "repo-shared");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "shared.ts");
  writeFileSync(file, "export const x = 1;\n");

  const cacheA = new IrCacheStore(dbPath);
  const cacheB = new IrCacheStore(dbPath);

  cacheA.readFile(file, { layer: "L1" });
  const r2 = cacheB.readFile(file, { layer: "L1" });
  assert.equal(r2.cached, true);
  assert.match(r2.content, /unchanged IR/);
});

test("layer L3 caches raw content", () => {
  const repo = join(tmp, "repo2");
  mkdirSync(repo, { recursive: true });
  const file = join(repo, "note.md");
  writeFileSync(file, "# hello\n");

  const cache = new IrCacheStore(join(tmp, "raw.db"));
  const r1 = cache.readFile(file, { layer: "L3" });
  assert.equal(r1.representation, "raw");
  assert.match(r1.content, /hello/);

  const r2 = cache.readFile(file, { layer: "L3" });
  assert.equal(r2.cached, true);
  assert.match(r2.content, /unchanged/);
});

rmSync(tmp, { recursive: true, force: true });
