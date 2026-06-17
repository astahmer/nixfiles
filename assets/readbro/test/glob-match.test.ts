import { test } from "node:test";
import assert from "node:assert/strict";
import { assignGlobGroup, dirGroup, matchGlob } from "../src/glob-match.ts";

test("matchGlob supports stars and double-stars", () => {
  assert.equal(matchGlob("assets/readbro/src/cache.ts", "assets/**/*.ts"), true);
  assert.equal(matchGlob("assets/readbro/src/cache.ts", "modules/**/*.ts"), false);
  assert.equal(matchGlob("hosts/macbook/default.nix", "hosts/**/*.nix"), true);
});

test("assignGlobGroup picks first matching pattern", () => {
  const patterns = ["assets/**", "assets/readbro/**"] as const;
  assert.equal(assignGlobGroup("assets/readbro/src/cache.ts", patterns), "assets/**");
});

test("dirGroup buckets by prefix depth", () => {
  assert.equal(dirGroup("assets/readbro/src/cache.ts", 2), "assets/readbro/**");
  assert.equal(dirGroup("hosts/macbook/default.nix", 1), "hosts/**");
});
