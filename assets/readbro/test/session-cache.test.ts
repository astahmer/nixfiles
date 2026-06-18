import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-session-"));

const makeRepo = (name: string) => {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  return repo;
};

test("new session gets full read when another session warmed ir_versions", () => {
  const repo = makeRepo("cross-session");
  const file = join(repo, "shared.ts");
  writeFileSync(file, "export const x = 1;\n");
  const db = join(tmp, "cross-session.db");

  const cacheA = new IrCacheStore({ dbPath: db, sessionId: "session-a" });
  const cacheB = new IrCacheStore({ dbPath: db, sessionId: "session-b" });

  const r1 = cacheA.readFile(file, { layer: "L1" });
  assert.equal(r1.outcome, "full");

  const r2 = cacheB.readFile(file, { layer: "L1" });
  assert.equal(r2.outcome, "full");
  assert.equal(r2.cached, false);
  assert.ok(!/unchanged IR/.test(r2.content));

  const r3 = cacheB.readFile(file, { layer: "L1" });
  assert.equal(r3.outcome, "cache_hit");
});

test("same session: unchanged re-read then diff after edit", () => {
  const repo = makeRepo("same-session");
  const file = join(repo, "edit.ts");
  writeFileSync(file, "export const answer = 1;\n");
  const db = join(tmp, "same-session.db");
  const cache = new IrCacheStore({ dbPath: db, sessionId: "edit-sess" });

  const r1 = cache.readFile(file, { layer: "L1" });
  assert.equal(r1.outcome, "full");

  const r2 = cache.readFile(file, { layer: "L1" });
  assert.equal(r2.outcome, "cache_hit");

  writeFileSync(file, "export const answer = 2;\nexport const extra = true;\n");
  const r3 = cache.readFile(file, { layer: "L1" });
  assert.equal(r3.outcome, "diff");
  assert.ok(r3.diff);
});

test("different session after file edit gets full not diff", () => {
  const repo = makeRepo("edit-cross");
  const file = join(repo, "v2.ts");
  writeFileSync(file, "export const v = 1;\n");
  const db = join(tmp, "edit-cross.db");

  const cacheA = new IrCacheStore({ dbPath: db, sessionId: "writer" });
  cacheA.readFile(file, { layer: "L1" });

  writeFileSync(file, "export const v = 2;\n");
  const cacheB = new IrCacheStore({ dbPath: db, sessionId: "reader" });
  const r = cacheB.readFile(file, { layer: "L1" });
  assert.equal(r.outcome, "full");
  assert.equal(r.cached, false);
});

test("layer reads are independent per session — L1 then L3 both full on first pass", () => {
  const repo = makeRepo("layers");
  const file = join(repo, "note.md");
  writeFileSync(file, "# hello\n\nbody\n");
  const db = join(tmp, "layers.db");
  const cache = new IrCacheStore({ dbPath: db, sessionId: "layer-sess" });

  const r1 = cache.readFile(file, { layer: "L1" });
  assert.equal(r1.outcome, "full");

  const r3 = cache.readFile(file, { layer: "L3" });
  assert.equal(r3.outcome, "full");
  assert.match(r3.content, /hello/);
});

test("same session L0 then L1 returns full L1 payload (no cross-layer diff)", () => {
  const repo = makeRepo("drill");
  const file = join(repo, "drill.ts");
  writeFileSync(
    file,
    `export class Widget {
  run(): number {
    return 42;
  }
}
`,
  );
  const db = join(tmp, "drill.db");
  const cache = new IrCacheStore({ dbPath: db, sessionId: "drill-sess" });

  const r0 = cache.readFile(file, { layer: "L0" });
  assert.equal(r0.outcome, "full");

  const r1 = cache.readFile(file, { layer: "L1" });
  assert.equal(r1.outcome, "full");
  assert.notEqual(r1.content, r0.content);
  assert.doesNotMatch(r1.content, /^--- a\//);
});

test("force always returns full and bypasses cache", () => {
  const repo = makeRepo("force");
  const file = join(repo, "force.ts");
  writeFileSync(file, "export const forced = true;\n");
  const db = join(tmp, "force.db");
  const cache = new IrCacheStore({ dbPath: db, sessionId: "force-sess" });

  cache.readFile(file, { layer: "L1" });
  const r2 = cache.readFile(file, { layer: "L1", force: true });
  assert.equal(r2.outcome, "full");
  assert.equal(r2.cached, false);
});

rmSync(tmp, { recursive: true, force: true });
