import { dirGroup, normalizePath } from "./glob-match.ts";

export const discoverTopGlobPatterns = (
  relPaths: ReadonlyArray<string>,
  limit: number,
): ReadonlyArray<string> => {
  const scores = new Map<string, number>();

  for (const relPath of relPaths) {
    const normalized = normalizePath(relPath);
    const parts = normalized.split("/").filter((part) => part.length > 0);
    const maxDepth = Math.min(parts.length, 4);

    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const pattern = dirGroup(normalized, depth);
      scores.set(pattern, (scores.get(pattern) ?? 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([pattern]) => pattern);
};
