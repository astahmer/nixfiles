import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IrCacheStore } from "../src/cache.ts";
import {
  formatClearResult,
  formatSessionsList,
  formatUsageList,
} from "../src/format.ts";
import {
  listQueryFromInput,
  parseClearFlags,
  parseLsFlags,
  parseSessionsFlags,
  sessionsQueryFromInput,
} from "../src/stats-cli.ts";
import { parseDuration, parseSince } from "../src/stats-query.ts";
import { wantsHelp } from "../src/fast-help.ts";

test("parseDuration accepts months", () => {
  assert.equal(parseSince("30m"), 30 * 60_000);
  assert.equal(parseDuration("3M", "--older-than"), 3 * 30 * 86_400_000);
});

test("parseClearFlags reads --older-than", () => {
  assert.deepEqual(parseClearFlags(["--older-than", "7d"]), {
    path: undefined,
    olderThanMs: 7 * 86_400_000,
  });
});

test("parseLsFlags defaults and filters", () => {
  const input = parseLsFlags(["-n", "5", "--grep", "read", "--source", "mcp"]);
  assert.equal(input.limit, 5);
  assert.equal(input.grep, "read");
  assert.equal(input.source, "mcp");
  assert.deepEqual(listQueryFromInput(input).source, "mcp");
});

test("parseSessionsFlags paginates", () => {
  const input = parseSessionsFlags(["--limit", "3", "--skip", "2", "--since", "24h"]);
  assert.equal(input.limit, 3);
  assert.equal(input.skip, 2);
  assert.equal(sessionsQueryFromInput(input).sinceMs, 24 * 3_600_000);
});

test("wantsHelp detects -h and --help", () => {
  assert.equal(wantsHelp(["--verbose", "-h"]), true);
  assert.equal(wantsHelp(["--json"]), false);
});

test("listUsage and listSessions read recorded activity", () => {
  const tmp = mkdtempSync(join(tmpdir(), "readbro-history-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  const file = join(repo, "sample.ts");
  writeFileSync(file, "export const x = 1;\n");
  const dbPath = join(tmp, "cache.db");

  const writer = new IrCacheStore({ dbPath, sessionId: "sess-one", usageSource: "cli" });
  writer.logUsage("read", "sample.ts");
  writer.readFile(file, { layer: "L1" });
  writer.readFile(file, { layer: "L1" });

  const reader = new IrCacheStore({ dbPath, sessionId: "sess-two", usageSource: "mcp" });
  reader.logUsage("read_file", "sample.ts", "mcp");
  reader.readFile(file, { layer: "L1" });

  const usage = reader.listUsage({ anchorPath: repo, limit: 10 });
  assert.ok(usage.length >= 2);
  assert.match(formatUsageList(usage), /read/);

  const allSessions = reader.listSessions({ anchorPath: repo, limit: 10, source: "all" });
  assert.ok(allSessions.some((row) => row.sessionId === "sess-one"));
  assert.ok(allSessions.some((row) => row.sessionId === "sess-two"));

  const mcpSessions = reader.listSessions({ anchorPath: repo, limit: 10 });
  assert.ok(mcpSessions.some((row) => row.sessionId === "sess-two"));
  assert.equal(
    mcpSessions.some((row) => row.sessionId === "sess-one"),
    false,
    "CLI sessions hidden by default",
  );
  assert.match(formatSessionsList(mcpSessions), /sess-two/);

  const pruned = reader.clear({ olderThanMs: 86_400_000 });
  assert.equal(pruned.fullClear, false);
  assert.match(formatClearResult(pruned), /Pruned cache older than 1d/);

  rmSync(tmp, { recursive: true, force: true });
});
