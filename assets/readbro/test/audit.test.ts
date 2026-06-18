import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSessionAudit } from "../src/audit.ts";
import { IrCacheStore } from "../src/cache.ts";

const tmp = mkdtempSync(join(tmpdir(), "readbro-audit-"));

test("runSessionAudit reports repeat paths and batch summary", () => {
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));
  mkdirSync(join(repo, "src"), { recursive: true });
  const fileA = join(repo, "src/a.ts");
  const fileB = join(repo, "src/b.ts");
  writeFileSync(fileA, "export const a = 1;\n");
  writeFileSync(fileB, "export const b = 2;\n");

  const db = join(tmp, "audit.db");
  const sessionId = "audit-sess";
  const cache = new IrCacheStore({ dbPath: db, sessionId, usageSource: "mcp" });

  cache.readFile(fileA, { layer: "L1" });
  cache.readFile(fileA, { layer: "L3", offset: 0, maxLines: 10 });
  cache.readFile(fileB, { layer: "L1" });
  cache.logUsage("read_file", fileA);
  cache.logUsage("read_file", fileA);
  cache.logUsage("read_file", `${fileA} ${fileB}`);

  const audit = runSessionAudit(cache, { sessionId, anchorPath: repo });
  assert.equal(audit.sessionId, sessionId);
  assert.ok(audit.repeatPaths.some((row) => row.path.endsWith("src/a.ts")));
  assert.equal(audit.summary.batchCalls, 1);
  assert.ok(audit.summary.totalReadCalls >= 2);
});

rmSync(tmp, { recursive: true, force: true });
