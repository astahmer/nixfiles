import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { McpTipCoach, READBRO_TIPS, appendMcpFooter, formatTipsList, resetMcpTipCoach } from "../src/tips.ts";

const TINY_TIPS = [
  { id: "a", text: "tip A" },
  { id: "b", text: "tip B" },
  { id: "c", text: "tip C" },
] as const;

test("formatTipsList includes all tips", () => {
  const text = formatTipsList(TINY_TIPS);
  assert.match(text, /tip A/);
  assert.match(text, /tip B/);
  assert.match(text, /3 tips/);
});

test("nextTip cycles through all tips without repeat until reshuffle", () => {
  let i = 0;
  const coach = new McpTipCoach({
    tips: TINY_TIPS,
    random: () => {
      const order = [0, 1, 2];
      return order[i++]! / 3;
    },
  });

  const seen: Array<string> = [];
  for (let n = 0; n < 3; n += 1) {
    const tip = coach.nextTip();
    assert.ok(tip);
    seen.push(tip!);
  }
  assert.equal(new Set(seen).size, 3);

  const fourth = coach.nextTip();
  assert.ok(fourth);
  assert.equal(coach.cycle(), 2, "reshuffles after pool exhausted");
});

test("repeat path hint on second read of same file", () => {
  const coach = new McpTipCoach({ tips: TINY_TIPS, repeatWarnCooldownMs: 0, batchWarnCooldownMs: 60_000 });
  coach.recordToolCall("read_file", { path: "spec.ts", layer: "L1" });
  assert.equal(coach.repeatPathHint("read_file", { path: "spec.ts" }), null);

  coach.recordToolCall("read_file", { path: "spec.ts", layer: "L3" });
  const warn = coach.repeatPathHint("read_file", { path: "spec.ts", layer: "L3" });
  assert.match(warn ?? "", /read #2 of spec.ts/);
  assert.equal(coach.pathReadCount("spec.ts"), 2);
});

test("batch warning after two rapid single-path read_file calls", () => {
  const coach = new McpTipCoach({ tips: TINY_TIPS, rapidWindowMs: 10_000, repeatWarnCooldownMs: 60_000 });
  coach.recordToolCall("read_file", { path: "a.ts" });
  assert.equal(coach.batchWarning("read_file", { path: "b.ts" }), null);

  coach.recordToolCall("read_file", { path: "b.ts" });
  const warn = coach.batchWarning("read_file", { path: "c.ts" });
  assert.match(warn ?? "", /Serial read_file/);
});

test("no batch warning for path array or target shorthand", () => {
  const coach = new McpTipCoach({ tips: TINY_TIPS });
  coach.recordToolCall("read_file", { path: "a.ts" });
  coach.recordToolCall("read_file", { path: "b.ts" });
  assert.equal(coach.batchWarning("read_file", { path: ["a.ts", "b.ts"] }), null);
  assert.equal(coach.batchWarning("read_file", { path: "x.ts", target: "Foo" }), null);
});

test("search_symbol resets batch warn cooldown path", () => {
  const coach = new McpTipCoach({ tips: TINY_TIPS, rapidWindowMs: 10_000 });
  coach.recordToolCall("read_file", { path: "a.ts" });
  coach.recordToolCall("read_file", { path: "b.ts" });
  coach.recordToolCall("search_symbol", { target: "Foo" });
  coach.recordToolCall("read_file", { path: "c.ts" });
  assert.equal(coach.batchWarning("read_file", { path: "d.ts" }), null);
});

test("appendMcpFooter skips JSON responses", () => {
  resetMcpTipCoach(new McpTipCoach({ tips: TINY_TIPS }));
  const json = '{"scope":"session"}';
  assert.equal(appendMcpFooter("session_status", {}, json), json);
});

test("READBRO_TIPS has unique ids", () => {
  const ids = READBRO_TIPS.map((tip) => tip.id);
  assert.equal(ids.length, new Set(ids).size);
});
