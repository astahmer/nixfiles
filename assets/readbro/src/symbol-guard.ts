import { estimateTokens } from "./ir.ts";

const TOKEN_CHAR_RATIO = 4;

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
  const hintLines = [
    "",
    `[readbro: search_symbol output truncated (~${tokens.toLocaleString()} tokens, budget ${budget.toLocaleString()}).`,
    `Target: ${targetLabel}. Narrow with path: "src/..." or a more specific symbol name.`,
  ];
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
