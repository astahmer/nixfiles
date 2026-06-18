import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  aroundLineToRange,
  findSymbolLineInL0,
  parseRangeEntry,
  resolveReadWindows,
} from "../src/read-windows.ts";

test("aroundLineToRange centers on line with context", () => {
  assert.deepEqual(aroundLineToRange(223, 40), [183, 263]);
});

test("parseRangeEntry accepts numeric and symbol entries", () => {
  assert.deepEqual(parseRangeEntry([140, 220]), { kind: "numeric", range: [140, 220] });
  assert.deepEqual(parseRangeEntry("processPayment"), { kind: "symbol", name: "processPayment" });
});

test("resolveReadWindows maps around_line to L3 slice", () => {
  const resolved = resolveReadWindows({ around_line: 100, context: 10 });
  assert.equal(resolved.layer, "L3");
  assert.equal(resolved.sliceContent, true);
  assert.deepEqual(resolved.numericRanges, [[90, 110]]);
});

test("findSymbolLineInL0 parses composto L0 markers", () => {
  const l0 = ["OUT CLASS:Readbro L32", "METHOD:readFile L120"].join("\n");
  assert.equal(findSymbolLineInL0(l0, "readFile"), 120);
  assert.equal(findSymbolLineInL0(l0, "Readbro"), 32);
});
