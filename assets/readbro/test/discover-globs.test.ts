import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverTopGlobPatterns } from "../src/discover-globs.ts";

test("discoverTopGlobPatterns ranks busiest prefixes", () => {
  const patterns = discoverTopGlobPatterns(
    [
      "assets/readbro/src/cache.ts",
      "assets/readbro/src/format.ts",
      "modules/shell.nix",
    ],
    3,
  );

  assert.ok(patterns.length <= 3);
  assert.ok(patterns.some((pattern) => pattern.startsWith("assets/")));
});
