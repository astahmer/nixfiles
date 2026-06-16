import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { computeDiff } from "./differ.mjs";
import { estimateTokens, generatePayload } from "./ir.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ir_versions (
  cache_key   TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  payload     TEXT NOT NULL,
  repr        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (cache_key, source_hash)
);

CREATE TABLE IF NOT EXISTS session_reads (
  session_id  TEXT NOT NULL,
  cache_key   TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  read_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, cache_key)
);

CREATE TABLE IF NOT EXISTS stats (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, key)
);

INSERT OR IGNORE INTO stats (key, value) VALUES ('tokens_saved', 0);
`;

function cacheKey(absPath, layer) {
  return `${absPath}\0${layer}`;
}

export class IrCacheStore {
  #db;
  #sessionId;

  constructor(dbPath, sessionId) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(SCHEMA);
    this.#sessionId = sessionId;
  }

  #addTokensSaved(tokens) {
    this.#db.prepare("UPDATE stats SET value = value + ? WHERE key = 'tokens_saved'").run(tokens);
    this.#db
      .prepare(
        `INSERT INTO session_stats (session_id, key, value) VALUES (?, 'tokens_saved', ?)
         ON CONFLICT(session_id, key) DO UPDATE SET value = value + ?`,
      )
      .run(this.#sessionId, tokens, tokens);
  }

  readFile(filePath, options = {}) {
    const absPath = resolve(filePath);
    const layer = options.layer ?? "L1";
    const force = options.force ?? false;
    const now = Date.now();
    const key = cacheKey(absPath, layer);

    const { payload, sourceHash, representation } = generatePayload(absPath, layer);
    const payloadTokens = estimateTokens(payload);

    if (force) {
      this.#storeVersion(key, sourceHash, payload, representation, now);
      this.#setSessionRead(key, sourceHash, now);
      return {
        cached: false,
        content: payload,
        sourceHash,
        layer,
        representation,
        totalTokens: payloadTokens,
      };
    }

    const lastRead = this.#db
      .prepare("SELECT source_hash FROM session_reads WHERE session_id = ? AND cache_key = ?")
      .get(this.#sessionId, key);

    if (lastRead && lastRead.source_hash === sourceHash) {
      this.#addTokensSaved(payloadTokens);
      this.#db
        .prepare("UPDATE session_reads SET read_at = ? WHERE session_id = ? AND cache_key = ?")
        .run(now, this.#sessionId, key);
      const label = `[composto-cachebro: unchanged IR (${layer}, ${representation}), ~${payloadTokens} tokens saved]`;
      return {
        cached: true,
        content: label,
        sourceHash,
        layer,
        representation,
        linesChanged: 0,
        totalTokens: payloadTokens,
      };
    }

    this.#storeVersion(key, sourceHash, payload, representation, now);

    if (lastRead) {
      const oldRow = this.#db
        .prepare("SELECT payload FROM ir_versions WHERE cache_key = ? AND source_hash = ?")
        .get(key, lastRead.source_hash);

      this.#setSessionRead(key, sourceHash, now);

      if (oldRow) {
        const diffResult = computeDiff(oldRow.payload, payload, filePath);
        if (diffResult.hasChanges) {
          const saved = Math.max(0, payloadTokens - estimateTokens(diffResult.diff));
          this.#addTokensSaved(saved);
          return {
            cached: true,
            content: diffResult.diff,
            diff: diffResult.diff,
            sourceHash,
            layer,
            representation,
            linesChanged: diffResult.linesChanged,
            totalTokens: payloadTokens,
          };
        }
      }
    } else {
      this.#setSessionRead(key, sourceHash, now);
    }

    return {
      cached: false,
      content: payload,
      sourceHash,
      layer,
      representation,
      totalTokens: payloadTokens,
    };
  }

  #storeVersion(key, sourceHash, payload, representation, now) {
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO ir_versions (cache_key, source_hash, payload, repr, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, sourceHash, payload, representation, now);
  }

  #setSessionRead(key, sourceHash, now) {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO session_reads (session_id, cache_key, source_hash, read_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(this.#sessionId, key, sourceHash, now);
  }

  getStats() {
    const files = this.#db.prepare("SELECT COUNT(DISTINCT cache_key) as c FROM ir_versions").get();
    const tokens = this.#db.prepare("SELECT value FROM stats WHERE key = 'tokens_saved'").get();
    const sessionTokens = this.#db
      .prepare("SELECT value FROM session_stats WHERE session_id = ? AND key = 'tokens_saved'")
      .get(this.#sessionId);
    return {
      filesTracked: files?.c ?? 0,
      tokensSaved: tokens?.value ?? 0,
      sessionTokensSaved: sessionTokens?.value ?? 0,
    };
  }

  clear() {
    this.#db.exec(
      "DELETE FROM ir_versions; DELETE FROM session_reads; DELETE FROM session_stats; UPDATE stats SET value = 0;",
    );
  }
}

export function defaultDbPath() {
  const dir = resolve(process.env.COMPOSTO_CACHEBRO_DIR ?? ".composto-cachebro");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, "cache.db");
}
