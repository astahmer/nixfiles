import { relative, resolve } from "node:path";
import type { IrCacheStore, UsageEvent } from "./cache.ts";
import { findRepoRoot } from "./repo-root.ts";

export type RepeatPathRow = {
  readonly path: string;
  readonly reads: number;
  readonly layers: ReadonlyArray<string>;
};

export type CoalesceCandidate = {
  readonly paths: ReadonlyArray<string>;
  readonly at: number;
};

export type SymbolBloatRow = {
  readonly target: string;
  readonly detail?: string;
  readonly at: number;
};

export type SessionAuditSummary = {
  readonly totalReadCalls: number;
  readonly uniquePaths: number;
  readonly batchCalls: number;
  readonly estimatedExtraRoundTrips: number;
};

export type SessionAudit = {
  readonly sessionId: string;
  readonly repeatPaths: ReadonlyArray<RepeatPathRow>;
  readonly coalesceCandidates: ReadonlyArray<CoalesceCandidate>;
  readonly symbolBloat: ReadonlyArray<SymbolBloatRow>;
  readonly summary: SessionAuditSummary;
};

const countPathSegments = (detail?: string): number => {
  if (!detail) {
    return 0;
  }
  return detail.trim().split(/\s+/).filter((part) => part.includes("/") || part.endsWith(".ts")).length;
};

export const runSessionAudit = (
  cache: IrCacheStore,
  input: { readonly sessionId?: string; readonly anchorPath?: string } = {},
): SessionAudit => {
  const sessionId = input.sessionId ?? cache.sessionId();
  const anchor = resolve(input.anchorPath ?? process.cwd());
  const root = findRepoRoot(anchor);

  const usage = cache
    .listUsage({ sessionId, limit: 500, anchorPath: anchor })
    .filter((event) => event.sessionId.startsWith(sessionId));

  const readEvents = cache.listSessionReadEvents(sessionId, anchor);
  const repeatMap = new Map<string, { reads: number; layers: Set<string> }>();
  for (const row of readEvents) {
    const display = relative(root, row.filePath) || row.filePath;
    const entry = repeatMap.get(display) ?? { reads: 0, layers: new Set<string>() };
    entry.reads += 1;
    entry.layers.add(row.layer);
    repeatMap.set(display, entry);
  }

  const repeatPaths = [...repeatMap.entries()]
    .map(([path, value]) => ({
      path,
      reads: value.reads,
      layers: [...value.layers].sort(),
    }))
    .filter((row) => row.reads > 1)
    .sort((a, b) => b.reads - a.reads);

  const readUsage = usage.filter((event) => event.name === "read_file" || event.name === "read");
  const batchCalls = readUsage.filter((event) => countPathSegments(event.detail) > 1).length;
  const uniquePaths = new Set<string>();
  for (const event of readUsage) {
    const detail = event.detail ?? "";
    for (const part of detail.split(/\s+/)) {
      if (part.includes(".") || part.includes("/")) {
        uniquePaths.add(part);
      }
    }
  }

  const coalesceCandidates = findCoalesceCandidates(readUsage);
  const symbolBloat = usage
    .filter((event) => event.name === "search_symbol" || event.name === "symbol")
    .map((event) => ({
      target: event.detail?.split(" ").slice(1).join(" ") ?? event.detail ?? "unknown",
      detail: event.detail,
      at: event.usedAt,
    }));

  const totalReadCalls = readUsage.length;
  const estimatedExtraRoundTrips = Math.max(0, totalReadCalls - batchCalls - 1) + repeatPaths.reduce(
    (sum, row) => sum + row.reads - 1,
    0,
  );

  return {
    sessionId,
    repeatPaths,
    coalesceCandidates,
    symbolBloat,
    summary: {
      totalReadCalls,
      uniquePaths: uniquePaths.size,
      batchCalls,
      estimatedExtraRoundTrips,
    },
  };
};

const findCoalesceCandidates = (events: ReadonlyArray<UsageEvent>): Array<CoalesceCandidate> => {
  const candidates: Array<CoalesceCandidate> = [];
  const sorted = [...events].sort((a, b) => a.usedAt - b.usedAt);

  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    if (event.name !== "read_file" && event.name !== "read") {
      continue;
    }
    if (countPathSegments(event.detail) !== 1) {
      continue;
    }

    const window: Array<UsageEvent> = [event];
    for (let next = index + 1; next < sorted.length; next += 1) {
      const candidate = sorted[next]!;
      if (candidate.usedAt - event.usedAt > 100) {
        break;
      }
      if (
        (candidate.name === "read_file" || candidate.name === "read") &&
        countPathSegments(candidate.detail) === 1
      ) {
        window.push(candidate);
      }
    }

    if (window.length >= 2) {
      candidates.push({
        paths: window.map((item) => item.detail?.trim() ?? "unknown"),
        at: event.usedAt,
      });
    }
  }

  return candidates;
};

export const formatSessionAudit = (audit: SessionAudit, json = false): string => {
  if (json) {
    return JSON.stringify(audit, null, 2);
  }

  const lines = [
    `readbro audit — session ${audit.sessionId}`,
    "",
    "Summary",
    `  read_file calls: ${audit.summary.totalReadCalls}`,
    `  unique paths:    ${audit.summary.uniquePaths}`,
    `  batch calls:     ${audit.summary.batchCalls}`,
    `  est. extra round-trips: ${audit.summary.estimatedExtraRoundTrips}`,
    "",
  ];

  if (audit.repeatPaths.length > 0) {
    lines.push("Repeat paths");
    for (const row of audit.repeatPaths) {
      lines.push(`  ${row.reads}× ${row.path} (${row.layers.join(", ")})`);
    }
    lines.push("");
  }

  if (audit.coalesceCandidates.length > 0) {
    lines.push("Coalesce candidates (parallel reads within 100ms)");
    for (const row of audit.coalesceCandidates.slice(0, 8)) {
      lines.push(`  [${new Date(row.at).toISOString()}] ${row.paths.join(" + ")}`);
    }
    lines.push(
      "  → read_file({ path: [\"a.ts\", \"b.ts\"], layer: \"L1\" })",
      "",
    );
  }

  if (audit.symbolBloat.length > 0) {
    lines.push("Symbol searches");
    for (const row of audit.symbolBloat.slice(0, 8)) {
      lines.push(`  ${row.target}${row.detail ? ` (${row.detail})` : ""}`);
    }
    lines.push("");
  }

  if (
    audit.repeatPaths.length === 0 &&
    audit.coalesceCandidates.length === 0 &&
    audit.symbolBloat.length === 0
  ) {
    lines.push("No batching issues detected in this session.");
  }

  return lines.join("\n");
};
