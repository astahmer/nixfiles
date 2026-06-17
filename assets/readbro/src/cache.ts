import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { computeDiff } from "./differ.ts";
import { estimateTokens, generatePayload, type IrLayer, type Representation } from "./ir.ts";
import { findRepoRoot } from "./repo-root.ts";

const REPO_SCOPE = "repo";

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

const cacheKey = (absPath: string, layer: IrLayer): string => `${absPath}\0${layer}`;

export const repoDbPath = (absPath: string): string => {
  if (process.env.READBRO_DIR) {
    const dir = resolve(process.env.READBRO_DIR);
    mkdirSync(dir, { recursive: true });
    return join(dir, "cache.db");
  }
  const root = findRepoRoot(absPath);
  const dir = join(root, ".readbro");
  mkdirSync(dir, { recursive: true });
  return join(dir, "cache.db");
};

export type ReadFileOptions = {
  readonly layer?: IrLayer;
  readonly force?: boolean;
};

export type ReadFileResult = {
  readonly cached: boolean;
  readonly content: string;
  readonly sourceHash: string;
  readonly layer: IrLayer;
  readonly representation: Representation;
  readonly linesChanged?: number;
  readonly diff?: string;
  readonly totalTokens: number;
};

export type CacheStats = {
  readonly filesTracked: number;
  readonly tokensSaved: number;
  readonly repoTokensSaved: number;
};

type DbConn = { readonly db: DatabaseSync; readonly dbPath: string };

export class IrCacheStore {
  readonly #fixedDbPath: string | null;
  readonly #connections = new Map<string, DbConn>();

  constructor(dbPathOrOptions: string | { readonly dbPath?: string } = {}) {
    if (typeof dbPathOrOptions === "string") {
      this.#fixedDbPath = dbPathOrOptions;
    } else {
      this.#fixedDbPath = dbPathOrOptions.dbPath ?? null;
    }
  }

  #connectionFor(absPath: string): DbConn {
    const dbPath = this.#fixedDbPath ?? repoDbPath(absPath);
    let conn = this.#connections.get(dbPath);
    if (!conn) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      db.exec(SCHEMA);
      conn = { db, dbPath };
      this.#connections.set(dbPath, conn);
    }
    return conn;
  }

  #addTokensSaved(db: DatabaseSync, tokens: number): void {
    db.prepare("UPDATE stats SET value = value + ? WHERE key = 'tokens_saved'").run(tokens);
    db
      .prepare(
        `INSERT INTO session_stats (session_id, key, value) VALUES (?, 'tokens_saved', ?)
         ON CONFLICT(session_id, key) DO UPDATE SET value = value + ?`,
      )
      .run(REPO_SCOPE, tokens, tokens);
  }

  readFile(filePath: string, options: ReadFileOptions = {}): ReadFileResult {
    const absPath = resolve(filePath);
    const layer = options.layer ?? "L1";
    const force = options.force ?? false;
    const now = Date.now();
    const key = cacheKey(absPath, layer);
    const { db } = this.#connectionFor(absPath);

    const { payload, sourceHash, representation } = generatePayload(absPath, layer);
    const payloadTokens = estimateTokens(payload);

    if (force) {
      this.#storeVersion(db, key, sourceHash, payload, representation, now);
      this.#setLastRead(db, key, sourceHash, now);
      return {
        cached: false,
        content: payload,
        sourceHash,
        layer,
        representation,
        totalTokens: payloadTokens,
      };
    }

    const lastRead = db
      .prepare("SELECT source_hash FROM session_reads WHERE session_id = ? AND cache_key = ?")
      .get(REPO_SCOPE, key) as { source_hash: string } | undefined;

    if (lastRead && lastRead.source_hash === sourceHash) {
      this.#addTokensSaved(db, payloadTokens);
      db
        .prepare("UPDATE session_reads SET read_at = ? WHERE session_id = ? AND cache_key = ?")
        .run(now, REPO_SCOPE, key);
      const label = `[readbro: unchanged IR (${layer}, ${representation}), ~${payloadTokens} tokens saved]`;
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

    this.#storeVersion(db, key, sourceHash, payload, representation, now);

    if (lastRead) {
      const oldRow = db
        .prepare("SELECT payload FROM ir_versions WHERE cache_key = ? AND source_hash = ?")
        .get(key, lastRead.source_hash) as { payload: string } | undefined;

      this.#setLastRead(db, key, sourceHash, now);

      if (oldRow) {
        const diffResult = computeDiff(oldRow.payload, payload, filePath);
        if (diffResult.hasChanges) {
          const saved = Math.max(0, payloadTokens - estimateTokens(diffResult.diff));
          this.#addTokensSaved(db, saved);
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
      this.#setLastRead(db, key, sourceHash, now);
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

  #storeVersion(
    db: DatabaseSync,
    key: string,
    sourceHash: string,
    payload: string,
    representation: Representation,
    now: number,
  ): void {
    db
      .prepare(
        `INSERT OR IGNORE INTO ir_versions (cache_key, source_hash, payload, repr, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, sourceHash, payload, representation, now);
  }

  #setLastRead(db: DatabaseSync, key: string, sourceHash: string, now: number): void {
    db
      .prepare(
        `INSERT OR REPLACE INTO session_reads (session_id, cache_key, source_hash, read_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(REPO_SCOPE, key, sourceHash, now);
  }

  getStats(anchorPath: string = process.cwd()): CacheStats {
    // Stats/gain CLI and session_status may run before any read opens the repo DB.
    this.#connectionFor(resolve(anchorPath));

    let filesTracked = 0;
    let tokensSaved = 0;
    let repoTokensSaved = 0;

    for (const { db } of this.#connections.values()) {
      const files = db.prepare("SELECT COUNT(DISTINCT cache_key) as c FROM ir_versions").get() as
        | { c: number }
        | undefined;
      const tokens = db.prepare("SELECT value FROM stats WHERE key = 'tokens_saved'").get() as
        | { value: number }
        | undefined;
      const repoTokens = db
        .prepare("SELECT value FROM session_stats WHERE session_id = ? AND key = 'tokens_saved'")
        .get(REPO_SCOPE) as { value: number } | undefined;
      filesTracked += files?.c ?? 0;
      tokensSaved += tokens?.value ?? 0;
      repoTokensSaved += repoTokens?.value ?? 0;
    }

    return { filesTracked, tokensSaved, repoTokensSaved };
  }

  clear(filePath?: string): void {
    if (!filePath && this.#connections.size === 0) {
      this.#connectionFor(process.cwd());
    }

    const targets = filePath
      ? [this.#connectionFor(resolve(filePath))]
      : [...this.#connections.values()];

    for (const { db, dbPath } of targets) {
      db.exec(
        "DELETE FROM ir_versions; DELETE FROM session_reads; DELETE FROM session_stats; UPDATE stats SET value = 0;",
      );
      this.#connections.delete(dbPath);
    }
  }
}
