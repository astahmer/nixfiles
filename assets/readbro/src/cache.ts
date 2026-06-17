import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { computeDiff } from "./differ.ts";
import { estimateTokens, generatePayload, type IrLayer, type Representation } from "./ir.ts";
import { findRepoRoot } from "./repo-root.ts";

const REPO_SCOPE = "repo";
const SCHEMA_VERSION = 2;

const CREATE_SCHEMA = `
CREATE TABLE ir_versions (
  file_path   TEXT NOT NULL,
  layer       TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  payload     TEXT NOT NULL,
  repr        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (file_path, layer, source_hash)
);

CREATE TABLE session_reads (
  session_id  TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  layer       TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  read_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, file_path, layer)
);

CREATE TABLE read_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  read_at       INTEGER NOT NULL,
  file_path     TEXT NOT NULL,
  layer         TEXT NOT NULL,
  raw_tokens    INTEGER NOT NULL,
  billed_tokens INTEGER NOT NULL,
  saved_tokens  INTEGER NOT NULL,
  outcome       TEXT NOT NULL
);

CREATE TABLE schema_meta (
  version INTEGER NOT NULL
);

INSERT INTO schema_meta (version) VALUES (${SCHEMA_VERSION});
`;

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

export type ReadOutcome = "full" | "cache_hit" | "diff";

export type ReadFileResult = {
  readonly cached: boolean;
  readonly content: string;
  readonly sourceHash: string;
  readonly layer: IrLayer;
  readonly representation: Representation;
  readonly linesChanged?: number;
  readonly diff?: string;
  readonly totalTokens: number;
  readonly billedTokens: number;
  readonly savedTokens: number;
  readonly outcome: ReadOutcome;
};

export type LayerStats = {
  readonly layer: IrLayer;
  readonly reads: number;
  readonly rawTokens: number;
  readonly billedTokens: number;
  readonly savedTokens: number;
};

export type FileStats = {
  readonly filePath: string;
  readonly layer: IrLayer;
  readonly reads: number;
  readonly rawTokens: number;
  readonly savedTokens: number;
  readonly avgSavedPct: number;
};

export type RecentRead = {
  readonly readAt: number;
  readonly filePath: string;
  readonly layer: IrLayer;
  readonly rawTokens: number;
  readonly savedTokens: number;
  readonly outcome: ReadOutcome;
};

export type OutcomeStats = {
  readonly outcome: ReadOutcome;
  readonly reads: number;
  readonly rawTokens: number;
  readonly savedTokens: number;
};

export type CacheStats = {
  readonly filesTracked: number;
  readonly totalReads: number;
  readonly rawTokens: number;
  readonly billedTokens: number;
  readonly savedTokens: number;
  readonly savedPct: number;
  readonly byLayer: ReadonlyArray<LayerStats>;
  readonly byOutcome: ReadonlyArray<OutcomeStats>;
  readonly byFile: ReadonlyArray<FileStats>;
  readonly recent: ReadonlyArray<RecentRead>;
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

  #ensureSchema(db: DatabaseSync): void {
    const metaTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
      .get() as { name: string } | undefined;

    if (metaTable) {
      const versionRow = db
        .prepare("SELECT version FROM schema_meta LIMIT 1")
        .get() as { version: number } | undefined;
      if (versionRow?.version === SCHEMA_VERSION) {
        return;
      }
    } else {
      const hasTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1")
        .get() as { name: string } | undefined;
      if (!hasTables) {
        db.exec(CREATE_SCHEMA);
        return;
      }
    }

    db.exec(`
      DROP TABLE IF EXISTS ir_versions;
      DROP TABLE IF EXISTS session_reads;
      DROP TABLE IF EXISTS read_events;
      DROP TABLE IF EXISTS stats;
      DROP TABLE IF EXISTS session_stats;
      DROP TABLE IF EXISTS schema_meta;
    `);
    db.exec(CREATE_SCHEMA);
  }

  #connectionFor(absPath: string): DbConn {
    const dbPath = this.#fixedDbPath ?? repoDbPath(absPath);
    let conn = this.#connections.get(dbPath);
    if (!conn) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      this.#ensureSchema(db);
      conn = { db, dbPath };
      this.#connections.set(dbPath, conn);
    }
    return conn;
  }

  #logRead(
    db: DatabaseSync,
    filePath: string,
    layer: IrLayer,
    rawTokens: number,
    billedTokens: number,
    outcome: ReadOutcome,
    readAt: number,
  ): void {
    const savedTokens = rawTokens - billedTokens;
    db.prepare(
      `INSERT INTO read_events (read_at, file_path, layer, raw_tokens, billed_tokens, saved_tokens, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(readAt, filePath, layer, rawTokens, billedTokens, savedTokens, outcome);
  }

  readFile(filePath: string, options: ReadFileOptions = {}): ReadFileResult {
    const absPath = resolve(filePath);
    const layer = options.layer ?? "L1";
    const force = options.force ?? false;
    const now = Date.now();
    const { db } = this.#connectionFor(absPath);

    const { payload, sourceHash, representation } = generatePayload(absPath, layer);
    const payloadTokens = estimateTokens(payload);

    const finish = (
      result: Omit<ReadFileResult, "totalTokens" | "billedTokens" | "savedTokens" | "outcome"> & {
        readonly billedTokens: number;
        readonly outcome: ReadOutcome;
      },
    ): ReadFileResult => {
      const billedTokens = result.billedTokens;
      const savedTokens = payloadTokens - billedTokens;
      this.#logRead(db, absPath, layer, payloadTokens, billedTokens, result.outcome, now);
      return {
        ...result,
        totalTokens: payloadTokens,
        billedTokens,
        savedTokens,
        outcome: result.outcome,
      };
    };

    if (force) {
      this.#storeVersion(db, absPath, layer, sourceHash, payload, representation, now);
      this.#setLastRead(db, absPath, layer, sourceHash, now);
      return finish({
        cached: false,
        content: payload,
        sourceHash,
        layer,
        representation,
        billedTokens: payloadTokens,
        outcome: "full",
      });
    }

    const lastRead = db
      .prepare(
        "SELECT source_hash FROM session_reads WHERE session_id = ? AND file_path = ? AND layer = ?",
      )
      .get(REPO_SCOPE, absPath, layer) as { source_hash: string } | undefined;

    if (lastRead && lastRead.source_hash === sourceHash) {
      db.prepare(
        "UPDATE session_reads SET read_at = ? WHERE session_id = ? AND file_path = ? AND layer = ?",
      ).run(now, REPO_SCOPE, absPath, layer);
      const label = `[readbro: unchanged IR (${layer}, ${representation}), ~${payloadTokens} tokens saved]`;
      return finish({
        cached: true,
        content: label,
        sourceHash,
        layer,
        representation,
        linesChanged: 0,
        billedTokens: estimateTokens(label),
        outcome: "cache_hit",
      });
    }

    this.#storeVersion(db, absPath, layer, sourceHash, payload, representation, now);

    if (lastRead) {
      const oldRow = db
        .prepare(
          "SELECT payload FROM ir_versions WHERE file_path = ? AND layer = ? AND source_hash = ?",
        )
        .get(absPath, layer, lastRead.source_hash) as { payload: string } | undefined;

      this.#setLastRead(db, absPath, layer, sourceHash, now);

      if (oldRow) {
        const diffResult = computeDiff(oldRow.payload, payload, filePath);
        if (diffResult.hasChanges) {
          const header = `[readbro: ${diffResult.linesChanged} IR lines changed, layer ${layer}, ${representation}]`;
          const billedTokens = estimateTokens(`${header}\n${diffResult.diff}`);
          return finish({
            cached: true,
            content: diffResult.diff,
            diff: diffResult.diff,
            sourceHash,
            layer,
            representation,
            linesChanged: diffResult.linesChanged,
            billedTokens,
            outcome: "diff",
          });
        }
      }
    } else {
      this.#setLastRead(db, absPath, layer, sourceHash, now);
    }

    return finish({
      cached: false,
      content: payload,
      sourceHash,
      layer,
      representation,
      billedTokens: payloadTokens,
      outcome: "full",
    });
  }

  #storeVersion(
    db: DatabaseSync,
    filePath: string,
    layer: IrLayer,
    sourceHash: string,
    payload: string,
    representation: Representation,
    now: number,
  ): void {
    db.prepare(
      `INSERT OR IGNORE INTO ir_versions (file_path, layer, source_hash, payload, repr, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(filePath, layer, sourceHash, payload, representation, now);
  }

  #setLastRead(
    db: DatabaseSync,
    filePath: string,
    layer: IrLayer,
    sourceHash: string,
    now: number,
  ): void {
    db.prepare(
      `INSERT OR REPLACE INTO session_reads (session_id, file_path, layer, source_hash, read_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(REPO_SCOPE, filePath, layer, sourceHash, now);
  }

  getStats(anchorPath: string = process.cwd()): CacheStats {
    const anchor = resolve(anchorPath);
    this.#connectionFor(anchor);

    let filesTracked = 0;
    let totalReads = 0;
    let rawTokens = 0;
    let billedTokens = 0;
    let savedTokens = 0;
    const layerMap = new Map<IrLayer, LayerStats>();
    const outcomeMap = new Map<ReadOutcome, OutcomeStats>();
    const fileMap = new Map<string, FileStats & { billedTokens: number }>();
    const recent: RecentRead[] = [];

    const displayPath = (filePath: string): string => {
      try {
        const root = findRepoRoot(anchor);
        if (filePath.startsWith(root)) {
          return relative(root, filePath) || filePath;
        }
      } catch {
        // fall through
      }
      return filePath;
    };

    for (const { db } of this.#connections.values()) {
      const files = db
        .prepare("SELECT COUNT(DISTINCT file_path || char(1) || layer) as c FROM ir_versions")
        .get() as { c: number } | undefined;
      const totals = db
        .prepare(
          `SELECT
             COUNT(*) as reads,
             COALESCE(SUM(raw_tokens), 0) as raw_tokens,
             COALESCE(SUM(billed_tokens), 0) as billed_tokens,
             COALESCE(SUM(saved_tokens), 0) as saved_tokens
           FROM read_events`,
        )
        .get() as
        | { reads: number; raw_tokens: number; billed_tokens: number; saved_tokens: number }
        | undefined;

      const outcomeRows = db
        .prepare(
          `SELECT
             outcome,
             COUNT(*) as reads,
             COALESCE(SUM(raw_tokens), 0) as raw_tokens,
             COALESCE(SUM(saved_tokens), 0) as saved_tokens
           FROM read_events
           GROUP BY outcome
           ORDER BY saved_tokens DESC`,
        )
        .all() as Array<{
        outcome: ReadOutcome;
        reads: number;
        raw_tokens: number;
        saved_tokens: number;
      }>;

      const layerRows = db
        .prepare(
          `SELECT
             layer,
             COUNT(*) as reads,
             COALESCE(SUM(raw_tokens), 0) as raw_tokens,
             COALESCE(SUM(billed_tokens), 0) as billed_tokens,
             COALESCE(SUM(saved_tokens), 0) as saved_tokens
           FROM read_events
           GROUP BY layer
           ORDER BY saved_tokens DESC`,
        )
        .all() as Array<{
        layer: IrLayer;
        reads: number;
        raw_tokens: number;
        billed_tokens: number;
        saved_tokens: number;
      }>;

      const fileRows = db
        .prepare(
          `SELECT
             file_path,
             layer,
             COUNT(*) as reads,
             COALESCE(SUM(raw_tokens), 0) as raw_tokens,
             COALESCE(SUM(saved_tokens), 0) as saved_tokens,
             COALESCE(AVG(CAST(saved_tokens AS REAL) / NULLIF(raw_tokens, 0) * 100), 0) as avg_saved_pct
           FROM read_events
           GROUP BY file_path, layer
           ORDER BY saved_tokens DESC
           LIMIT 10`,
        )
        .all() as Array<{
        file_path: string;
        layer: IrLayer;
        reads: number;
        raw_tokens: number;
        saved_tokens: number;
        avg_saved_pct: number;
      }>;

      const recentRows = db
        .prepare(
          `SELECT read_at, file_path, layer, raw_tokens, saved_tokens, outcome
           FROM read_events
           ORDER BY read_at DESC
           LIMIT 10`,
        )
        .all() as Array<{
        read_at: number;
        file_path: string;
        layer: IrLayer;
        raw_tokens: number;
        saved_tokens: number;
        outcome: ReadOutcome;
      }>;

      filesTracked += files?.c ?? 0;
      totalReads += totals?.reads ?? 0;
      rawTokens += totals?.raw_tokens ?? 0;
      billedTokens += totals?.billed_tokens ?? 0;
      savedTokens += totals?.saved_tokens ?? 0;

      for (const row of outcomeRows) {
        const existing = outcomeMap.get(row.outcome);
        if (existing) {
          outcomeMap.set(row.outcome, {
            outcome: row.outcome,
            reads: existing.reads + row.reads,
            rawTokens: existing.rawTokens + row.raw_tokens,
            savedTokens: existing.savedTokens + row.saved_tokens,
          });
        } else {
          outcomeMap.set(row.outcome, {
            outcome: row.outcome,
            reads: row.reads,
            rawTokens: row.raw_tokens,
            savedTokens: row.saved_tokens,
          });
        }
      }

      for (const row of layerRows) {
        const existing = layerMap.get(row.layer);
        if (existing) {
          layerMap.set(row.layer, {
            layer: row.layer,
            reads: existing.reads + row.reads,
            rawTokens: existing.rawTokens + row.raw_tokens,
            billedTokens: existing.billedTokens + row.billed_tokens,
            savedTokens: existing.savedTokens + row.saved_tokens,
          });
        } else {
          layerMap.set(row.layer, {
            layer: row.layer,
            reads: row.reads,
            rawTokens: row.raw_tokens,
            billedTokens: row.billed_tokens,
            savedTokens: row.saved_tokens,
          });
        }
      }

      for (const row of fileRows) {
        const key = `${row.file_path}\0${row.layer}`;
        const existing = fileMap.get(key);
        if (existing) {
          fileMap.set(key, {
            filePath: displayPath(row.file_path),
            layer: row.layer,
            reads: existing.reads + row.reads,
            rawTokens: existing.rawTokens + row.raw_tokens,
            savedTokens: existing.savedTokens + row.saved_tokens,
            billedTokens: existing.billedTokens,
            avgSavedPct:
              existing.rawTokens + row.raw_tokens > 0
                ? ((existing.savedTokens + row.saved_tokens) /
                    (existing.rawTokens + row.raw_tokens)) *
                  100
                : 0,
          });
        } else {
          fileMap.set(key, {
            filePath: displayPath(row.file_path),
            layer: row.layer,
            reads: row.reads,
            rawTokens: row.raw_tokens,
            savedTokens: row.saved_tokens,
            billedTokens: 0,
            avgSavedPct: row.avg_saved_pct,
          });
        }
      }

      recent.push(
        ...recentRows.map((row) => ({
          readAt: row.read_at,
          filePath: displayPath(row.file_path),
          layer: row.layer,
          rawTokens: row.raw_tokens,
          savedTokens: row.saved_tokens,
          outcome: row.outcome,
        })),
      );
    }

    const byLayer = [...layerMap.values()].sort((a, b) => b.savedTokens - a.savedTokens);
    const byOutcome = [...outcomeMap.values()].sort((a, b) => b.savedTokens - a.savedTokens);
    const byFile = [...fileMap.values()]
      .sort((a, b) => b.savedTokens - a.savedTokens)
      .slice(0, 10)
      .map(({ billedTokens: _billed, ...row }) => row);
    const savedPct = rawTokens > 0 ? (savedTokens / rawTokens) * 100 : 0;

    return {
      filesTracked,
      totalReads,
      rawTokens,
      billedTokens,
      savedTokens,
      savedPct,
      byLayer,
      byOutcome,
      byFile,
      recent: recent.sort((a, b) => b.readAt - a.readAt).slice(0, 10),
    };
  }

  clear(filePath?: string): void {
    if (!filePath && this.#connections.size === 0) {
      this.#connectionFor(process.cwd());
    }

    const targets = filePath
      ? [this.#connectionFor(resolve(filePath))]
      : [...this.#connections.values()];

    for (const { db, dbPath } of targets) {
      db.exec("DELETE FROM ir_versions; DELETE FROM session_reads; DELETE FROM read_events;");
      this.#connections.delete(dbPath);
    }
  }
}
