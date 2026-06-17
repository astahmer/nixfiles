import type { CacheStats, ReadFileResult, ReadOutcome } from "./cache.ts";

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

export const truncatePath = (filePath: string, maxLen = 28): string => {
  if (filePath.length <= maxLen) {
    return filePath;
  }
  const tail = maxLen - 3;
  const start = Math.ceil(tail * 0.35);
  const end = tail - start;
  return `${filePath.slice(0, start)}...${filePath.slice(-end)}`;
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

const formatSummary = (stats: CacheStats, title: string): string[] => {
  const lines = [
    title,
    "═".repeat(60),
    "",
    `Total reads:       ${stats.totalReads.toLocaleString()}`,
    `Raw tokens:        ${formatTokenCount(stats.rawTokens)}`,
    `Billed tokens:     ${formatTokenCount(stats.billedTokens)}`,
    `Tokens saved:      ${formatTokenCount(stats.savedTokens)} (${formatPct(stats.savedPct)})`,
    `Files tracked:     ${stats.filesTracked.toLocaleString()}`,
    `Efficiency meter:  ${formatBar(Math.max(0, stats.savedPct))} ${formatPct(stats.savedPct)}`,
    "",
  ];

  if (stats.byLayer.length > 0) {
    lines.push(
      "By Layer",
      "─".repeat(71),
      `  #  Layer  Count  Raw       Billed    Saved     Avg%    Impact    `,
      "─".repeat(71),
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
        )}  ${pad(formatTokenCount(row.savedTokens), 8)}  ${pad(formatPct(avgPct), 6)}  ${formatImpact(
          row.savedTokens,
          maxLayerSaved,
        )}`,
      );
    });
    lines.push("─".repeat(71), "");
  }

  if (stats.byOutcome.length > 0) {
    lines.push(
      "By Outcome",
      "─".repeat(71),
      `  #  Outcome     Count  Raw       Saved     Avg%    Impact    `,
      "─".repeat(71),
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
        )}  ${pad(formatPct(avgPct), 6)}  ${formatImpact(row.savedTokens, maxOutcomeSaved)}`,
      );
    });
    lines.push("─".repeat(71), "");
  }

  return lines;
};

export const formatReadResult = (
  result: ReadFileResult,
  stats: Pick<CacheStats, "savedTokens">,
  showFooter = true,
): string => {
  let text = "";
  if (result.cached && result.linesChanged === 0) {
    text = result.content;
  } else if (result.cached && result.diff) {
    text = `[readbro: ${result.linesChanged} IR lines changed, layer ${result.layer}, ${result.representation}]\n${result.diff}`;
  } else {
    text = `[readbro: layer ${result.layer}, ${result.representation}]\n${result.content}`;
  }
  if (showFooter && result.cached && stats.savedTokens > 0) {
    text += `\n\n[~${stats.savedTokens.toLocaleString()} tokens saved in repo cache]`;
  }
  return text;
};

export const formatStats = (stats: CacheStats): string => {
  const lines = formatSummary(stats, "readbro Token Savings (Repo Scope)");
  lines.push("Tip: run `readbro gain` for per-file breakdown and recent reads.");
  return lines.join("\n");
};

export const formatGain = (stats: CacheStats): string => {
  const lines = formatSummary(stats, "readbro Token Savings (Repo Scope)");

  if (stats.byFile.length > 0) {
    lines.push(
      "By File",
      "─".repeat(71),
      `  #  File                          Layer  Count  Saved     Avg%    Impact    `,
      "─".repeat(71),
    );

    const maxFileSaved = Math.max(...stats.byFile.map((row) => row.savedTokens), 0);
    stats.byFile.forEach((row, index) => {
      lines.push(
        ` ${String(index + 1).padStart(2)}.  ${pad(truncatePath(row.filePath, 28), 28)}  ${pad(
          row.layer,
          5,
        )}  ${pad(row.reads.toLocaleString(), 5)}  ${pad(
          formatTokenCount(row.savedTokens),
          8,
        )}  ${pad(formatPct(row.avgSavedPct), 6)}  ${formatImpact(row.savedTokens, maxFileSaved)}`,
      );
    });
    lines.push("─".repeat(71), "");
  }

  if (stats.recent.length > 0) {
    lines.push("Recent Reads", "─".repeat(58));
    for (const row of stats.recent) {
      const when = new Date(row.readAt);
      const stamp = `${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(
        2,
        "0",
      )} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const savedPct = row.rawTokens > 0 ? (row.savedTokens / row.rawTokens) * 100 : 0;
      const icon = formatRecentIcon(row.outcome, savedPct);
      const label = truncatePath(row.filePath, 24);
      const savedLabel =
        row.savedTokens > 0
          ? `-${formatPct(savedPct)} (${formatTokenCount(row.savedTokens)})`
          : "full read";
      lines.push(
        `${stamp} ${icon} ${pad(`${row.layer} ${label}`, 28)} ${savedLabel}`,
      );
    }
  }

  return lines.join("\n");
};
