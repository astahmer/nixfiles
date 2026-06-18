import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { guardSymbolOutput } from "../src/symbol-guard.ts";

test("guardSymbolOutput passes through small payloads", () => {
  const output = "small result";
  assert.equal(guardSymbolOutput(output, 4000, ["Foo"]), output);
});

test("guardSymbolOutput truncates oversized payloads", () => {
  const output = "x".repeat(40_000);
  const guarded = guardSymbolOutput(output, 4000, ["UseWideEventLoggerFn"]);
  assert.ok(guarded.length < output.length);
  assert.match(guarded, /truncated/i);
  assert.match(guarded, /UseWideEventLoggerFn/);
});
