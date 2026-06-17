import { assignGlobGroup, dirGroup, matchGlob } from "./glob-match.ts";
import type {
  CacheStats,
  FileStats,
  GlobStats,
  LayerStats,
  OutcomeStats,
  ReadOutcome,
  RecentRead,
  RepresentationStats,
} from "./cache.ts";
import type { IrLayer, Representation } from "./ir.ts";
import type { StatsQuery } from "./stats-query.ts";

export type ReadEventRow = {
  readonly read_at: number;
  readonly session_id: string;
  readonly file_path: string;
  readonly layer: IrLayer;
  readonly repr: Representation;
  readonly raw_tokens: number;
  readonly billed_tokens: number;
  readonly saved_tokens: number;
  readonly outcome: ReadOutcome;
  readonly duration_ms: number;
};

const addLayer = (map: Map<IrLayer, LayerStats>, row: ReadEventRow): void => {
  const existing = map.get(row.layer);
  if (existing) {
    map.set(row.layer, {
      layer: row.layer,
      reads: existing.reads + 1,
      rawTokens: existing.rawTokens + row.raw_tokens,
      billedTokens: existing.billedTokens + row.billed_tokens,
      savedTokens: existing.savedTokens + row.saved_tokens,
      durationMs: existing.durationMs + row.duration_ms,
    });
    return;
  }
  map.set(row.layer, {
    layer: row.layer,
    reads: 1,
    rawTokens: row.raw_tokens,
    billedTokens: row.billed_tokens,
    savedTokens: row.saved_tokens,
    durationMs: row.duration_ms,
  });
};

const addRepresentation = (
  map: Map<Representation, RepresentationStats>,
  row: ReadEventRow,
): void => {
  const existing = map.get(row.repr);
  if (existing) {
    map.set(row.repr, {
      representation: row.repr,
      reads: existing.reads + 1,
      rawTokens: existing.rawTokens + row.raw_tokens,
      billedTokens: existing.billedTokens + row.billed_tokens,
      savedTokens: existing.savedTokens + row.saved_tokens,
      durationMs: existing.durationMs + row.duration_ms,
    });
    return;
  }
  map.set(row.repr, {
    representation: row.repr,
    reads: 1,
    rawTokens: row.raw_tokens,
    billedTokens: row.billed_tokens,
    savedTokens: row.saved_tokens,
    durationMs: row.duration_ms,
  });
};

const addOutcome = (map: Map<ReadOutcome, OutcomeStats>, row: ReadEventRow): void => {
  const existing = map.get(row.outcome);
  if (existing) {
    map.set(row.outcome, {
      outcome: row.outcome,
      reads: existing.reads + 1,
      rawTokens: existing.rawTokens + row.raw_tokens,
      savedTokens: existing.savedTokens + row.saved_tokens,
      durationMs: existing.durationMs + row.duration_ms,
    });
    return;
  }
  map.set(row.outcome, {
    outcome: row.outcome,
    reads: 1,
    rawTokens: row.raw_tokens,
    savedTokens: row.saved_tokens,
    durationMs: row.duration_ms,
  });
};

const addFile = (
  map: Map<string, { reads: number; rawTokens: number; savedTokens: number; layer: IrLayer; filePath: string }>,
  row: ReadEventRow,
  relPath: string,
): void => {
  const key = `${row.file_path}\0${row.layer}`;
  const existing = map.get(key);
  if (existing) {
    map.set(key, {
      ...existing,
      reads: existing.reads + 1,
      rawTokens: existing.rawTokens + row.raw_tokens,
      savedTokens: existing.savedTokens + row.saved_tokens,
    });
    return;
  }
  map.set(key, {
    filePath: relPath,
    layer: row.layer,
    reads: 1,
    rawTokens: row.raw_tokens,
    savedTokens: row.saved_tokens,
  });
};

type GlobAccumulator = {
  readonly pattern: string;
  readonly reads: number;
  readonly rawTokens: number;
  readonly billedTokens: number;
  readonly savedTokens: number;
  readonly durationMs: number;
  readonly files: Set<string>;
};

const addGlob = (
  map: Map<string, GlobAccumulator>,
  pattern: string,
  row: ReadEventRow,
  relPath: string,
): void => {
  const existing = map.get(pattern);
  if (existing) {
    existing.files.add(`${row.file_path}\0${row.layer}`);
    map.set(pattern, {
      pattern,
      reads: existing.reads + 1,
      rawTokens: existing.rawTokens + row.raw_tokens,
      billedTokens: existing.billedTokens + row.billed_tokens,
      savedTokens: existing.savedTokens + row.saved_tokens,
      durationMs: existing.durationMs + row.duration_ms,
      files: existing.files,
    });
    return;
  }
  map.set(pattern, {
    pattern,
    reads: 1,
    rawTokens: row.raw_tokens,
    billedTokens: row.billed_tokens,
    savedTokens: row.saved_tokens,
    durationMs: row.duration_ms,
    files: new Set([`${row.file_path}\0${row.layer}`]),
  });
};

export const aggregateEvents = (input: {
  readonly events: ReadonlyArray<ReadEventRow>;
  readonly query: StatsQuery;
  readonly sessionId: string;
  readonly displayPath: (filePath: string) => string;
}): CacheStats => {
  const scope = input.query.scope ?? "repo";
  const layerMap = new Map<IrLayer, LayerStats>();
  const representationMap = new Map<Representation, RepresentationStats>();
  const outcomeMap = new Map<ReadOutcome, OutcomeStats>();
  const fileMap = new Map<
    string,
    { reads: number; rawTokens: number; savedTokens: number; layer: IrLayer; filePath: string }
  >();
  const globMap = new Map<string, GlobAccumulator>();
  const recent: RecentRead[] = [];
  const trackedFiles = new Set<string>();

  const groupPatterns = input.query.groupGlobs ?? [];
  const useDirGroups = input.query.byDir !== undefined && groupPatterns.length === 0;

  let totalReads = 0;
  let rawTokens = 0;
  let billedTokens = 0;
  let savedTokens = 0;
  let totalDurationMs = 0;

  for (const row of input.events) {
    const relPath = input.displayPath(row.file_path);
    if (input.query.glob && !matchGlob(relPath, input.query.glob)) {
      continue;
    }

    totalReads += 1;
    rawTokens += row.raw_tokens;
    billedTokens += row.billed_tokens;
    savedTokens += row.saved_tokens;
    totalDurationMs += row.duration_ms;

    trackedFiles.add(`${row.file_path}\0${row.layer}`);
    addLayer(layerMap, row);
    addRepresentation(representationMap, row);
    addOutcome(outcomeMap, row);
    addFile(fileMap, row, relPath);

    if (groupPatterns.length > 0) {
      addGlob(globMap, assignGlobGroup(relPath, groupPatterns), row, relPath);
    } else if (useDirGroups) {
      addGlob(globMap, dirGroup(relPath, input.query.byDir ?? 1), row, relPath);
    } else if (input.query.glob) {
      addGlob(globMap, input.query.glob, row, relPath);
    }

    recent.push({
      readAt: row.read_at,
      filePath: relPath,
      layer: row.layer,
      representation: row.repr,
      rawTokens: row.raw_tokens,
      savedTokens: row.saved_tokens,
      outcome: row.outcome,
      durationMs: row.duration_ms,
    });
  }

  const byFile: Array<FileStats> = [...fileMap.values()]
    .map((row) => ({
      filePath: row.filePath,
      layer: row.layer,
      reads: row.reads,
      rawTokens: row.rawTokens,
      savedTokens: row.savedTokens,
      avgSavedPct: row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0,
    }))
    .sort((a, b) => b.savedTokens - a.savedTokens)
    .slice(0, 10);

  const byGlob: Array<GlobStats> = [...globMap.values()]
    .map(({ files, ...row }) => ({
      ...row,
      fileCount: files.size,
    }))
    .sort((a, b) => b.savedTokens - a.savedTokens);

  const savedPct = rawTokens > 0 ? (savedTokens / rawTokens) * 100 : 0;
  const avgDurationMs = totalReads > 0 ? totalDurationMs / totalReads : 0;

  return {
    scope,
    sinceMs: input.query.sinceMs,
    glob: input.query.glob,
    groupGlobs: input.query.groupGlobs,
    byDir: input.query.byDir,
    sessionId: input.sessionId,
    filesTracked: trackedFiles.size,
    totalReads,
    rawTokens,
    billedTokens,
    savedTokens,
    savedPct,
    totalDurationMs,
    avgDurationMs,
    byLayer: [...layerMap.values()].sort((a, b) => b.savedTokens - a.savedTokens),
    byRepresentation: [...representationMap.values()].sort(
      (a, b) => b.savedTokens - a.savedTokens,
    ),
    byOutcome: [...outcomeMap.values()].sort((a, b) => b.savedTokens - a.savedTokens),
    byGlob,
    byFile,
    recent: recent.sort((a, b) => b.readAt - a.readAt).slice(0, 10),
  };
};
