import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { runBounded } from "./sync-web-profile.mts";

test("a timeout kills the whole child process group, including SIGTERM-ignoring grandchildren", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sync-web-profile-"));
  try {
    const markerPath = join(temporaryDirectory, "child-survived");
    const grandchildScript = `
      process.on("SIGTERM", () => {});
      setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 700);
    `;
    const childScript = `
      require("node:child_process").spawn(process.execPath, ["-e", process.argv[2], process.argv[1]], { stdio: "ignore" });
      setTimeout(() => {}, 10_000);
    `;

    await assert.rejects(
      runBounded({
        command: [process.execPath, "-e", childScript, markerPath, grandchildScript],
        environment: process.env,
        timeoutMs: 200,
        termGraceMs: 100,
        label: "test subprocess",
      }),
      /exceeded/,
    );

    await sleep(800);
    assert.equal(existsSync(markerPath), false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
