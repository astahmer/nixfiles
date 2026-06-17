import { discoverTopGlobPatterns } from "./discover-globs.ts";
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
  map: Map<
    string,
    { reads: number; rawTokens: number; savedTokens: number; layer: IrLayer; filePath: string }
  >,
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
  reads: number;
  rawTokens: number;
  billedTokens: number;
  savedTokens: number;
  durationMs: number;
  cacheHits: number;
  fullReads: number;
  diffReads: number;
  readonly files: Set<string>;
};

const addGlob = (map: Map<string, GlobAccumulator>, pattern: string, row: ReadEventRow): void => {
  const existing = map.get(pattern);
  if (existing) {
    existing.files.add(`${row.file_path}\0${row.layer}`);
    existing.reads += 1;
    existing.rawTokens += row.raw_tokens;
    existing.billedTokens += row.billed_tokens;
    existing.savedTokens += row.saved_tokens;
    existing.durationMs += row.duration_ms;
    if (row.outcome === "cache_hit") {
      existing.cacheHits += 1;
    } else if (row.outcome === "full") {
      existing.fullReads += 1;
    } else if (row.outcome === "diff" || row.outcome === "zoom") {
      existing.diffReads += 1;
    }
    return;
  }

  map.set(pattern, {
    pattern,
    reads: 1,
    rawTokens: row.raw_tokens,
    billedTokens: row.billed_tokens,
    savedTokens: row.saved_tokens,
    durationMs: row.duration_ms,
    cacheHits: row.outcome === "cache_hit" ? 1 : 0,
    fullReads: row.outcome === "full" ? 1 : 0,
    diffReads: row.outcome === "diff" || row.outcome === "zoom" ? 1 : 0,
    files: new Set([`${row.file_path}\0${row.layer}`]),
  });
};

const toGlobStats = (row: GlobAccumulator): GlobStats => ({
  pattern: row.pattern,
  reads: row.reads,
  rawTokens: row.rawTokens,
  billedTokens: row.billedTokens,
  savedTokens: row.savedTokens,
  durationMs: row.durationMs,
  fileCount: row.files.size,
  cacheHits: row.cacheHits,
  fullReads: row.fullReads,
  diffReads: row.diffReads,
  hitRatePct: row.reads > 0 ? (row.cacheHits / row.reads) * 100 : 0,
});

export const aggregateEvents = (input: {
  readonly events: ReadonlyArray<ReadEventRow>;
  readonly query: StatsQuery;
  readonly sessionId: string;
  readonly displayPath: (filePath: string) => string;
}): CacheStats => {
  const scope = input.query.scope ?? "repo";
  const matching = input.events.flatMap((row) => {
    const relPath = input.displayPath(row.file_path);
    if (input.query.glob && !matchGlob(relPath, input.query.glob)) {
      return [];
    }
    return [{ row, relPath }];
  });

  let groupPatterns = [...(input.query.groupGlobs ?? [])];
  let discoveredGlobs: ReadonlyArray<string> | undefined;

  if (input.query.discoverGlobs && groupPatterns.length === 0 && input.query.byDir === undefined) {
    discoveredGlobs = discoverTopGlobPatterns(
      matching.map((entry) => entry.relPath),
      input.query.discoverGlobs,
    );
    groupPatterns = [...discoveredGlobs];
  }

  const useDirGroups = input.query.byDir !== undefined && groupPatterns.length === 0;

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

  let totalReads = 0;
  let rawTokens = 0;
  let billedTokens = 0;
  let savedTokens = 0;
  let totalDurationMs = 0;

  for (const { row, relPath } of matching) {
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
      addGlob(globMap, assignGlobGroup(relPath, groupPatterns), row);
    } else if (useDirGroups) {
      addGlob(globMap, dirGroup(relPath, input.query.byDir ?? 1), row);
    } else if (input.query.glob) {
      addGlob(globMap, input.query.glob, row);
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
    .sort((left, right) => right.savedTokens - left.savedTokens)
    .slice(0, 10);

  const byGlob: Array<GlobStats> = [...globMap.values()]
    .map(toGlobStats)
    .sort((left, right) => right.savedTokens - left.savedTokens);

  const savedPct = rawTokens > 0 ? (savedTokens / rawTokens) * 100 : 0;
  const avgDurationMs = totalReads > 0 ? totalDurationMs / totalReads : 0;

  return {
    scope,
    sinceMs: input.query.sinceMs,
    glob: input.query.glob,
    groupGlobs: input.query.groupGlobs,
    discoveredGlobs,
    byDir: input.query.byDir,
    discoverGlobs: input.query.discoverGlobs,
    sessionId: input.sessionId,
    filesTracked: trackedFiles.size,
    totalReads,
    rawTokens,
    billedTokens,
    savedTokens,
    savedPct,
    totalDurationMs,
    avgDurationMs,
    byLayer: [...layerMap.values()].sort((left, right) => right.savedTokens - left.savedTokens),
    byRepresentation: [...representationMap.values()].sort(
      (left, right) => right.savedTokens - left.savedTokens,
    ),
    byOutcome: [...outcomeMap.values()].sort((left, right) => right.savedTokens - left.savedTokens),
    byGlob,
    byFile,
    recent: recent.sort((left, right) => right.readAt - left.readAt).slice(0, 10),
  };
};
