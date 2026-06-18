import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { generateMdIr } from "../src/md-ir.ts";

const SAMPLE = `---
title: Agent Guide
tags: [agents, docs]
---

# Quick Start

Install the tool, then run \`readbro doctor\`.

## Commands

- \`readbro read\` — read one file
- \`readbro symbol\` — symbol search

See [readbro docs](https://example.com/readbro) for more.

\`\`\`typescript
export const hello = () => "world";
console.log(hello());
\`\`\`

![logo](assets/logo.png)
`;

test("generateMdIr L0 returns heading outline", () => {
  const ir = generateMdIr(SAMPLE, "L0", "docs/guide.md");
  assert.match(ir, /^guide\.md$/m);
  assert.match(ir, /META: title, tags/);
  assert.match(ir, /H1 Quick Start L/);
  assert.match(ir, /H2 Commands L/);
  assert.match(ir, /LINKS: 1/);
  assert.match(ir, /CODE: 1 blocks/);
  assert.match(ir, /IMAGES: 1/);
});

test("generateMdIr L1 compresses body and preserves structure", () => {
  const ir = generateMdIr(SAMPLE, "L1", "docs/guide.md");
  assert.match(ir, /# guide\.md/);
  assert.match(ir, /## Commands \[L/);
  assert.match(ir, /readbro read/);
  assert.match(ir, /LINK \[L\d+\]: readbro docs/);
  assert.match(ir, /CODE \[L\d+\]: typescript \(2 lines\)/);
  assert.match(ir, /IMG \[L\d+\]: logo/);
  assert.doesNotMatch(ir, /export const hello/);
});

test("generateMdIr L3 returns raw source", () => {
  assert.equal(generateMdIr(SAMPLE, "L3"), SAMPLE);
});

test("generateMdIr L2 matches L1 compression", () => {
  const l1 = generateMdIr(SAMPLE, "L1", "guide.md");
  const l2 = generateMdIr(SAMPLE, "L2", "guide.md");
  assert.equal(l2, l1);
});
