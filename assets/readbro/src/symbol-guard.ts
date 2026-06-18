import { estimateTokens } from "./ir.ts";

const TOKEN_CHAR_RATIO = 4;

const SYMBOL_NAME_RE = /(?:FN|CLASS|METHOD|TYPE|OUT TYPE|OUT CLASS|VAR):\s*(\S+)/g;

export const extractSymbolNames = (output: string): Array<string> => {
  const names = new Set<string>();
  for (const match of output.matchAll(SYMBOL_NAME_RE)) {
    const name = match[1];
    if (name && !name.startsWith("(")) {
      names.add(name);
    }
  }
  return [...names];
};

const commonPrefixLength = (a: string, b: string): number => {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index]!.toLowerCase() === b[index]!.toLowerCase()) {
    index += 1;
  }
  return index;
};

export const scoreSymbolSimilarity = (target: string, candidate: string): number => {
  if (candidate === target) {
    return 0;
  }
  const lowerTarget = target.toLowerCase();
  const lowerCandidate = candidate.toLowerCase();
  if (lowerCandidate.includes(lowerTarget) || lowerTarget.includes(lowerCandidate)) {
    return 80 + commonPrefixLength(target, candidate);
  }
  return commonPrefixLength(target, candidate);
};

export const suggestNarrowerTargets = (
  output: string,
  targets: ReadonlyArray<string>,
  limit = 3,
): ReadonlyArray<string> => {
  const target = targets[0];
  if (!target) {
    return [];
  }

  const ranked = extractSymbolNames(output)
    .map((name) => ({ name, score: scoreSymbolSimilarity(target, name) }))
    .filter((row) => row.score >= 8)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const row of ranked) {
    if (seen.has(row.name)) {
      continue;
    }
    seen.add(row.name);
    out.push(row.name);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
};

export const guardSymbolOutput = (
  output: string,
  budget: number,
  targets: ReadonlyArray<string>,
): string => {
  const tokens = estimateTokens(output);
  const maxTokens = Math.max(budget, 4000) * 1.15;
  if (tokens <= maxTokens) {
    return output;
  }

  const maxChars = Math.floor(budget * TOKEN_CHAR_RATIO);
  const slice = output.slice(0, maxChars);
  const targetLabel = targets.length > 0 ? targets.join(", ") : "context";
  const fileHints = extractFileHints(output).slice(0, 5);
  const suggestions = suggestNarrowerTargets(output, targets);
  const hintLines = [
    "",
    `[readbro: search_symbol output truncated (~${tokens.toLocaleString()} tokens, budget ${budget.toLocaleString()}).`,
    `Target: ${targetLabel}. Narrow with path: "src/..." or a more specific symbol name.`,
  ];
  if (suggestions.length > 0) {
    hintLines.push(`Did you mean: ${suggestions.map((s) => `"${s}"`).join(", ")}?`);
  }
  if (fileHints.length > 0) {
    hintLines.push(`Files in result: ${fileHints.join(", ")}`);
  }
  hintLines.push("]");
  return `${slice}\n${hintLines.join(" ")}`;
};

const extractFileHints = (output: string): Array<string> => {
  const hints = new Set<string>();
  const patterns = [
    /\[target\]\s+(\S+)/g,
    /\[detail\]\s+(\S+)/g,
    /\[L\d\]\s+(\S+)/g,
    /===\s+(\S+)\s+===/g,
  ];
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      const file = match[1];
      if (file && !file.startsWith("(")) {
        hints.add(file);
      }
    }
  }
  return [...hints];
};
