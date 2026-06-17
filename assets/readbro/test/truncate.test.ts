import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";
import { formatReadResult } from "../src/format.ts";
import { applyLineWindow, effectiveMaxLines } from "../src/truncate.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-truncate-"));

test("effectiveMaxLines caps L3/raw by default", () => {
  assert.equal(
    effectiveMaxLines({ layer: "L3", representation: "raw" }),
    200,
  );
  assert.equal(
    effectiveMaxLines({ layer: "L1", representation: "ir", maxLines: 50 }),
    50,
  );
  assert.equal(
    effectiveMaxLines({ layer: "L3", representation: "raw", maxLines: -1 }),
    undefined,
  );
});

test("formatReadResult truncates large L3 reads", () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "big.ts");
  writeFileSync(file, `${"export const line = 1;\n".repeat(400)}`);

  const cache = new IrCacheStore(join(tmp, "cap.db"));
  const result = cache.readFile(file, { layer: "L3" });
  const text = formatReadResult(result, { savedTokens: 0 });

  assert.match(text, /showing lines 1-200 of \d+/);
  assert.match(text, /L3\/raw returns full source/);
});

test("applyLineWindow supports offset", () => {
  const text = "a\nb\nc\nd\n";
  const window = applyLineWindow(text, { offset: 1, maxLines: 2 });
  assert.equal(window.text, "b\nc");
  assert.equal(window.truncated, true);
});

rmSync(tmp, { recursive: true, force: true });
