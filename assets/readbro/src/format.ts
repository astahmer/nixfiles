import type { CacheStats, ReadFileResult } from "./cache.ts";

export const formatReadResult = (
  result: ReadFileResult,
  stats: Pick<CacheStats, "repoTokensSaved">,
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
  if (showFooter && result.cached && stats.repoTokensSaved > 0) {
    text += `\n\n[~${stats.repoTokensSaved.toLocaleString()} tokens saved in repo cache]`;
  }
  return text;
};

export const formatStats = (stats: CacheStats): string =>
  [
    "readbro cache",
    "─".repeat(40),
    `  files tracked     ${stats.filesTracked}`,
    `  tokens saved      ~${stats.repoTokensSaved.toLocaleString()} (repo)`,
    `  tokens saved all  ~${stats.tokensSaved.toLocaleString()} (lifetime)`,
    "",
    "Tip: re-reads of unchanged files return a short notice instead of full IR.",
  ].join("\n");

export const formatGain = (stats: CacheStats): string => {
  const saved = stats.repoTokensSaved;
  const bar = saved > 0 ? "█".repeat(Math.min(20, Math.ceil(saved / 500))) : "░";
  return [
    "readbro gain",
    "─".repeat(40),
    `  ${bar} ~${saved.toLocaleString()} tokens saved`,
    `  ${stats.filesTracked} files in repo cache`,
    "",
    "run `readbro stats` for full breakdown",
  ].join("\n");
};
