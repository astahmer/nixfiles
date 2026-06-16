import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.mjs";

const tmp = mkdtempSync(join(tmpdir(), "composto-cachebro-"));
const dbPath = join(tmp, "cache.db");
const session = "test-session";

test("IR cache: first read full, second unchanged, third diff after edit", () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "sample.ts");
  writeFileSync(file, "export const answer = 1;\n");

  const cache = new IrCacheStore(dbPath, session);

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

test("layer L3 caches raw content", () => {
  const repo = join(tmp, "repo2");
  mkdirSync(repo, { recursive: true });
  const file = join(repo, "note.md");
  writeFileSync(file, "# hello\n");

  const cache = new IrCacheStore(join(tmp, "raw.db"), session + "-raw");
  const r1 = cache.readFile(file, { layer: "L3" });
  assert.equal(r1.representation, "raw");
  assert.match(r1.content, /hello/);

  const r2 = cache.readFile(file, { layer: "L3" });
  assert.equal(r2.cached, true);
  assert.match(r2.content, /unchanged/);
});

rmSync(tmp, { recursive: true, force: true });
