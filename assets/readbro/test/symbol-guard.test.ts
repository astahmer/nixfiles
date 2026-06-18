import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { guardSymbolOutput, suggestNarrowerTargets } from "../src/symbol-guard.ts";

test("guardSymbolOutput passes through small payloads", () => {
  const output = "small result";
  assert.equal(guardSymbolOutput(output, 4000, ["Foo"]), output);
});

test("guardSymbolOutput truncates oversized payloads", () => {
  const output = "x".repeat(40_000);
  const guarded = guardSymbolOutput(output, 4000, ["PaymentService"]);
  assert.ok(guarded.length < output.length);
  assert.match(guarded, /truncated/i);
  assert.match(guarded, /PaymentService/);
});

test("suggestNarrowerTargets prefers longer matching symbol names", () => {
  const output = [
    "FN:PaymentService L10",
    "FN:PaymentServiceFactory L42",
  ].join("\n");
  const suggestions = suggestNarrowerTargets(output, ["PaymentService"]);
  assert.ok(suggestions.includes("PaymentServiceFactory"));
});
