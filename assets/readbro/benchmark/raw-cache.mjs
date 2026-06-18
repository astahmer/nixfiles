/** Raw file session cache — mirrors cachebro semantics (MIT, adapted from reference). */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { computeDiff } from "../src/differ.ts";
import { contentHash, estimateTokens } from "../src/ir.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS file_versions (
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (path, hash)
);
CREATE TABLE IF NOT EXISTS session_reads (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (session_id, path)
);
`;

export class RawCacheStore {
  #db;
  #sessionId;

  constructor(dbPath, sessionId) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(SCHEMA);
    this.#sessionId = sessionId;
  }

  readFile(filePath) {
    const absPath = resolve(filePath);
    statSync(absPath);
    const currentContent = readFileSync(absPath, "utf-8");
    const currentHash = contentHash(currentContent);
    const payloadTokens = estimateTokens(currentContent);

    const lastRead = this.#db
      .prepare("SELECT hash FROM session_reads WHERE session_id = ? AND path = ?")
      .get(this.#sessionId, absPath);

    if (lastRead && lastRead.hash === currentHash) {
      return {
        tokens: payloadTokens,
        billed: estimateTokens(`[cachebro: unchanged, ${currentContent.split("\n").length} lines]`),
        mode: "unchanged",
      };
    }

    if (lastRead) {
      const oldVersion = this.#db
        .prepare("SELECT content FROM file_versions WHERE path = ? AND hash = ?")
        .get(absPath, lastRead.hash);

      this.#db
        .prepare(
          "INSERT OR IGNORE INTO file_versions (path, hash, content) VALUES (?, ?, ?)",
        )
        .run(absPath, currentHash, currentContent);

      this.#db
        .prepare(
          "INSERT OR REPLACE INTO session_reads (session_id, path, hash) VALUES (?, ?, ?)",
        )
        .run(this.#sessionId, absPath, currentHash);

      if (oldVersion) {
        const diffResult = computeDiff(oldVersion.content, currentContent, filePath);
        if (diffResult.hasChanges) {
          return {
            tokens: payloadTokens,
            billed: estimateTokens(diffResult.diff),
            mode: "diff",
          };
        }
      }
    } else {
      this.#db
        .prepare(
          "INSERT OR IGNORE INTO file_versions (path, hash, content) VALUES (?, ?, ?)",
        )
        .run(absPath, currentHash, currentContent);
      this.#db
        .prepare(
          "INSERT OR REPLACE INTO session_reads (session_id, path, hash) VALUES (?, ?, ?)",
        )
        .run(this.#sessionId, absPath, currentHash);
    }

    return { tokens: payloadTokens, billed: payloadTokens, mode: "full" };
  }
}
