import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { Readbro, ReadbroLive } from "../src/readbro.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-guard-"));

test("readFile rejects directory paths", async () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const dir = join(repo, "src");
  mkdirSync(dir);
  writeFileSync(join(dir, "ok.ts"), "export const ok = 1;\n");

  const program = Effect.gen(function* () {
    const rb = yield* Readbro;
    return yield* rb.readFile(dir, {});
  });

  const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(ReadbroLive)));
  assert.equal(exit._tag, "Failure");
  if (exit._tag === "Failure") {
    assert.match(String(exit.cause), /directory/);
  }
});

rmSync(tmp, { recursive: true, force: true });
