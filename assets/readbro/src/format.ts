import type { CacheStats, ClearResult, GlobStats, ReadFileResult, ReadOutcome, SessionSummary, UsageEvent } from "./cache.ts";
import type { HistoryFormat } from "./history-query.ts";
import { NON_CODE_EXT } from "./ir.ts";
import type { ReadbroReadOptions } from "./read-options.ts";
import type { StatsFormat } from "./stats-query.ts";
import { formatSinceLabel } from "./stats-query.ts";
import { applyLineWindow, effectiveMaxLines, lineWindowNotice } from "./truncate.ts";

export const formatTokenCount = (tokens: number): string => {
  const sign = tokens < 0 ? "-" : "";
  const abs = Math.abs(tokens);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${abs.toLocaleString()}`;
};

export const formatPct = (value: number): string => `${value.toFixed(1)}%`;

export const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
};

export const formatRelativeTime = (timestamp: number, now = Date.now()): string => {
  const delta = Math.max(0, now - timestamp);
  if (delta < 60_000) {
    return `${Math.max(1, Math.round(delta / 1000))}s ago`;
  }
  if (delta < 3_600_000) {
    return `${Math.round(delta / 60_000)}m ago`;
  }
  if (delta < 86_400_000) {
    return `${Math.round(delta / 3_600_000)}h ago`;
  }
  if (delta < 30 * 86_400_000) {
    return `${Math.round(delta / 86_400_000)}d ago`;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
};

export const formatBar = (pct: number, width = 24): string => {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
};

export const formatImpact = (saved: number, maxSaved: number, width = 10): string => {
  if (maxSaved <= 0 || saved <= 0) {
    return "░".repeat(width);
  }
  const filled = Math.max(1, Math.round((saved / maxSaved) * width));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
};

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

const outcomeLabel = (outcome: ReadOutcome): string => {
  switch (outcome) {
    case "cache_hit":
      return "unchanged";
    case "diff":
      return "diff";
    case "full":
      return "full";
  }
};

const formatRecentIcon = (outcome: ReadOutcome, savedPct: number): string => {
  if (outcome === "full") {
    return "•";
  }
  if (savedPct >= 80) {
    return "▲";
  }
  if (savedPct >= 40) {
    return "■";
  }
  return "•";
};

const statsTitle = (stats: CacheStats): string => {
  const scope = stats.scope === "session" ? "Session Scope" : "Repo Scope";
  const since = stats.sinceMs ? `, last ${formatSinceLabel(stats.sinceMs)}` : "";
  const glob = stats.glob ? `, glob ${stats.glob}` : "";
  const groups =
    stats.groupGlobs && stats.groupGlobs.length > 0
      ? `, groups ${stats.groupGlobs.join(", ")}`
      : "";
  const discovered =
    stats.discoveredGlobs && stats.discoveredGlobs.length > 0
      ? `, discovered ${stats.discoveredGlobs.length}`
      : "";
  const byDir = stats.byDir !== undefined ? `, by-dir ${stats.byDir}` : "";
  return `readbro Token Savings (${scope}${since}${glob}${groups}${discovered}${byDir})`;
};

const formatSummary = (stats: CacheStats): string[] => {
  const lines = [
    statsTitle(stats),
    "═".repeat(60),
    "",
    `Total reads:       ${stats.totalReads.toLocaleString()}`,
    `Raw tokens:        ${formatTokenCount(stats.rawTokens)}`,
    `Billed tokens:     ${formatTokenCount(stats.billedTokens)}`,
    `Tokens saved:      ${formatTokenCount(stats.savedTokens)} (${formatPct(stats.savedPct)})`,
    `Files tracked:     ${stats.filesTracked.toLocaleString()}`,
    `Total IR time:     ${formatDuration(stats.totalDurationMs)} (avg ${formatDuration(stats.avgDurationMs)})`,
    `Efficiency meter:  ${formatBar(Math.max(0, stats.savedPct))} ${formatPct(stats.savedPct)}`,
  ];

  if (stats.scope === "session") {
    lines.push(`Session id:        ${stats.sessionId}`);
  }

  return lines;
};

const formatTopFiles = (stats: CacheStats): string[] => {
  if (stats.byFile.length === 0) {
    return [];
  }

  const lines = ["", "Top Files (by tokens saved)", "─".repeat(60)];
  stats.byFile.forEach((row, index) => {
    lines.push(` ${String(index + 1).padStart(2)}. ${row.filePath}`);
    lines.push(
      `     layer ${row.layer} · ${row.reads} reads · raw ${formatTokenCount(row.rawTokens)} · saved ${formatTokenCount(row.savedTokens)} · ${formatPct(row.avgSavedPct)}`,
    );
  });
  return lines;
};

const formatDiscoveredGlobs = (stats: CacheStats): string[] => {
  if (!stats.discoveredGlobs || stats.discoveredGlobs.length === 0 || stats.byGlob.length === 0) {
    return [];
  }

  const lines = ["", "Top Paths (discovered)", "─".repeat(60)];
  const ranked = stats.byGlob.slice(0, stats.discoveredGlobs.length);
  ranked.forEach((row, index) => {
    lines.push(
      ` ${String(index + 1).padStart(2)}. ${row.pattern}`,
      `     ${row.reads} reads · ${row.fileCount} files · hit ${formatPct(row.hitRatePct)} · saved ${formatTokenCount(row.savedTokens)}`,
    );
  });
  return lines;
};

const formatByGlobTable = (rows: ReadonlyArray<GlobStats>): string[] => {
  if (rows.length === 0) {
    return [];
  }

  const lines = [
    "",
    "By Glob",
    "─".repeat(96),
    "  #  Pattern                              Files  Count  Saved     Hit%    Full  Diff  Time      Impact",
    "─".repeat(96),
  ];
  const maxSaved = Math.max(...rows.map((row) => row.savedTokens), 0);

  rows.forEach((row, index) => {
    lines.push(
      ` ${String(index + 1).padStart(2)}.  ${pad(row.pattern, 36)}  ${pad(
        row.fileCount.toLocaleString(),
        5,
      )}  ${pad(row.reads.toLocaleString(), 5)}  ${pad(
        formatTokenCount(row.savedTokens),
        8,
      )}  ${pad(formatPct(row.hitRatePct), 6)}  ${pad(
        row.fullReads.toLocaleString(),
        4,
      )}  ${pad(row.diffReads.toLocaleString(), 4)}  ${pad(
        formatDuration(row.durationMs),
        8,
      )}  ${formatImpact(row.savedTokens, maxSaved)}`,
    );
  });
  lines.push("─".repeat(96));
  return lines;
};

const formatBreakdownTables = (stats: CacheStats): string[] => {
  const lines: string[] = [];

  if (stats.byLayer.length > 0) {
    lines.push(
      "",
      "By Layer",
      "─".repeat(79),
      "  #  Layer  Count  Raw       Billed    Saved     Time      Avg%    Impact",
      "─".repeat(79),
    );
    const maxLayerSaved = Math.max(...stats.byLayer.map((row) => row.savedTokens), 0);
    stats.byLayer.forEach((row, index) => {
      const avgPct = row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0;
      lines.push(
        ` ${String(index + 1).padStart(2)}.  ${pad(row.layer, 5)}  ${pad(
          row.reads.toLocaleString(),
          5,
        )}  ${pad(formatTokenCount(row.rawTokens), 8)}  ${pad(
          formatTokenCount(row.billedTokens),
          8,
        )}  ${pad(formatTokenCount(row.savedTokens), 8)}  ${pad(
          formatDuration(row.durationMs),
          8,
        )}  ${pad(formatPct(avgPct), 6)}  ${formatImpact(row.savedTokens, maxLayerSaved)}`,
      );
    });
    lines.push("─".repeat(79));
  }

  if (stats.byRepresentation.length > 0) {
    lines.push(
      "",
      "By Representation",
      "─".repeat(79),
      "  #  Repr           Count  Raw       Billed    Saved     Time      Avg%    Impact",
      "─".repeat(79),
    );
    const maxReprSaved = Math.max(...stats.byRepresentation.map((row) => row.savedTokens), 0);
    stats.byRepresentation.forEach((row, index) => {
      const avgPct = row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0;
      lines.push(
        ` ${String(index + 1).padStart(2)}.  ${pad(row.representation, 13)}  ${pad(
          row.reads.toLocaleString(),
          5,
        )}  ${pad(formatTokenCount(row.rawTokens), 8)}  ${pad(
          formatTokenCount(row.billedTokens),
          8,
        )}  ${pad(formatTokenCount(row.savedTokens), 8)}  ${pad(
          formatDuration(row.durationMs),
          8,
        )}  ${pad(formatPct(avgPct), 6)}  ${formatImpact(row.savedTokens, maxReprSaved)}`,
      );
    });
    lines.push("─".repeat(79));
  }

  if (stats.byOutcome.length > 0) {
    lines.push(
      "",
      "By Outcome",
      "─".repeat(79),
      "  #  Outcome     Count  Raw       Saved     Time      Avg%    Impact",
      "─".repeat(79),
    );
    const maxOutcomeSaved = Math.max(...stats.byOutcome.map((row) => row.savedTokens), 0);
    stats.byOutcome.forEach((row, index) => {
      const avgPct = row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0;
      lines.push(
        ` ${String(index + 1).padStart(2)}.  ${pad(outcomeLabel(row.outcome), 10)}  ${pad(
          row.reads.toLocaleString(),
          5,
        )}  ${pad(formatTokenCount(row.rawTokens), 8)}  ${pad(
          formatTokenCount(row.savedTokens),
          8,
        )}  ${pad(formatDuration(row.durationMs), 8)}  ${pad(formatPct(avgPct), 6)}  ${formatImpact(
          row.savedTokens,
          maxOutcomeSaved,
        )}`,
      );
    });
    lines.push("─".repeat(79));
  }

  lines.push(...formatByGlobTable(stats.byGlob));
  return lines;
};

const formatRecentReads = (stats: CacheStats): string[] => {
  if (stats.recent.length === 0) {
    return [];
  }

  const lines = ["", "Recent Reads", "─".repeat(60)];
  for (const row of stats.recent) {
    const when = new Date(row.readAt);
    const stamp = `${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(
      2,
      "0",
    )} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    const savedPct = row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0;
    const icon = formatRecentIcon(row.outcome, savedPct);
    const savedLabel =
      row.savedTokens > 0
        ? `-${formatPct(savedPct)} (${formatTokenCount(row.savedTokens)})`
        : "full read";
    lines.push(
      `${stamp} ${icon} ${row.layer}/${row.representation} ${row.filePath}`,
      `          ${savedLabel} · ${formatDuration(row.durationMs)}`,
    );
  }
  return lines;
};

export const formatStatsJson = (stats: CacheStats): string => JSON.stringify(stats, null, 2);

const readAdvisories = (result: ReadFileResult, filePath?: string): string[] => {
  const lines: string[] = [];
  if (result.layer === "L3" || result.representation === "raw") {
    lines.push(
      "[readbro: L3/raw returns full source — use L1 (default) for behaviour IR unless you need exact text]",
    );
  }
  if (result.representation === "raw-fallback" && result.layer !== "L3") {
    const ext = filePath?.includes(".")
      ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
      : "";
    if (NON_CODE_EXT.has(ext)) {
      lines.push(
        `[readbro: no composto IR for ${ext} — L1 returns raw. Use max_lines to cap, or read_file with path array to batch plan docs]`,
      );
    } else {
      lines.push(
        "[readbro: composto IR unavailable — returned raw source. Run `readbro doctor`; ensure `composto` is on PATH]",
      );
    }
  }
  return lines;
};

export const formatReadResult = (
  result: ReadFileResult,
  stats: Pick<CacheStats, "savedTokens">,
  options: ReadbroReadOptions & { readonly showFooter?: boolean; readonly filePath?: string } = {},
): string => {
  const showFooter = options.showFooter ?? true;
  const advisories = readAdvisories(result, options.filePath);
  const parts: string[] = [];

  if (result.cached && result.linesChanged === 0) {
    parts.push(result.content);
  } else {
    const maxLines = effectiveMaxLines({
      layer: result.layer,
      representation: result.representation,
      maxLines: options.maxLines,
    });
    const window = applyLineWindow(
      result.cached && result.diff ? result.diff : result.content,
      { offset: options.offset, maxLines },
    );
    const windowNotice = lineWindowNotice(window);

    if (result.cached && result.diff) {
      parts.push(
        `[readbro: ${result.linesChanged} IR lines changed, layer ${result.layer}, ${result.representation}]`,
      );
    } else {
      parts.push(`[readbro: layer ${result.layer}, ${result.representation}]`);
    }

    if (windowNotice) {
      parts.push(windowNotice);
    }
    parts.push(...advisories);
    parts.push(window.text);
  }

  let text = parts.join("\n");
  if (showFooter && result.cached && stats.savedTokens > 0) {
    text += `\n\n[~${stats.savedTokens.toLocaleString()} tokens saved in repo cache]`;
  }
  return text;
};

export const formatStats = (stats: CacheStats, format: StatsFormat = {}): string => {
  if (format.json) {
    return formatStatsJson(stats);
  }

  const lines = formatSummary(stats);
  if (format.verbose) {
    lines.push(...formatBreakdownTables(stats));
  } else {
    lines.push("", "Tip: `readbro stats --verbose` for layer/repr/outcome/glob breakdown.");
  }
  return lines.join("\n");
};

export const formatGain = (stats: CacheStats, format: StatsFormat = {}): string => {
  if (format.json) {
    return formatStatsJson(stats);
  }

  const lines = formatSummary(stats);
  lines.push(...formatTopFiles(stats));

  if (stats.discoverGlobs && !format.verbose) {
    lines.push(...formatDiscoveredGlobs(stats));
  }

  if (format.verbose) {
    lines.push(...formatBreakdownTables(stats));
    lines.push(...formatRecentReads(stats));
  } else if (!stats.discoverGlobs) {
    lines.push("", "Tip: `readbro gain --verbose` for glob tables and recent reads.");
  }

  return lines.join("\n");
};

export const formatUsageList = (
  events: ReadonlyArray<UsageEvent>,
  format: HistoryFormat = {},
): string => {
  if (format.json) {
    return JSON.stringify(events, null, 2);
  }
  if (events.length === 0) {
    return "No recent usage recorded.";
  }

  const lines = ["Recent Usage", "─".repeat(72)];
  for (const row of events) {
    const detail = row.detail ? ` ${row.detail}` : "";
    lines.push(
      `${formatRelativeTime(row.usedAt).padEnd(8)} ${row.source.padEnd(3)} ${row.sessionId.padEnd(8)} ${row.name}${detail}`,
    );
  }
  lines.push("", "Tip: `readbro ls --grep read` or `--session <id>` to filter.");
  return lines.join("\n");
};

export const formatSessionsList = (
  sessions: ReadonlyArray<SessionSummary>,
  format: HistoryFormat = {},
): string => {
  if (format.json) {
    return JSON.stringify(sessions, null, 2);
  }
  if (sessions.length === 0) {
    return "No sessions recorded.";
  }

  const lines = ["Recent Sessions", "─".repeat(72)];
  for (const row of sessions) {
    lines.push(
      `${row.sessionId.padEnd(8)}  ${formatRelativeTime(row.lastAt).padEnd(8)}  ${String(row.reads).padStart(4)} reads  saved ${formatTokenCount(row.savedTokens).padStart(6)} (${formatPct(row.savedPct).padStart(5)})  active ${formatRelativeTime(row.lastAt)}`,
    );
  }
  lines.push("", "Tip: `readbro sessions --grep abc` or `--skip 20` to paginate.");
  return lines.join("\n");
};

export const formatClearResult = (result: ClearResult, path?: string): string => {
  if (result.fullClear) {
    return path
      ? `Cache cleared for ${path} working copy.`
      : "Cache cleared for all open repo databases.";
  }

  const scope = path ? ` for ${path}` : "";
  const label = result.olderThanMs ? formatSinceLabel(result.olderThanMs) : "cutoff";
  return [
    `Pruned cache older than ${label}${scope}:`,
    `  read events:    ${result.readEvents.toLocaleString()}`,
    `  usage events:   ${result.usageEvents.toLocaleString()}`,
    `  session reads:  ${result.sessionReads.toLocaleString()}`,
    `  ir versions:    ${result.irVersions.toLocaleString()}`,
  ].join("\n");
};
