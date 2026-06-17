const escapeRegex = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const globToRegex = (pattern: string): RegExp => {
  const normalized = pattern.replace(/\\/g, "/");
  let regex = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized.charAt(index);
    if (char.length === 0) {
      continue;
    }
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          regex += "(?:.*/)?";
          index += 2;
        } else {
          regex += ".*";
          index += 1;
        }
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegex(char);
  }
  regex += "$";
  return new RegExp(regex);
};

export const normalizePath = (filePath: string): string => filePath.replace(/\\/g, "/");

export const matchGlob = (filePath: string, pattern: string): boolean =>
  globToRegex(pattern).test(normalizePath(filePath));

export const assignGlobGroup = (
  filePath: string,
  patterns: ReadonlyArray<string>,
): string => {
  const normalized = normalizePath(filePath);
  for (const pattern of patterns) {
    if (matchGlob(normalized, pattern)) {
      return pattern;
    }
  }
  return "(other)";
};

export const dirGroup = (filePath: string, depth: number): string => {
  const parts = normalizePath(filePath).split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return ".";
  }
  if (parts.length <= depth) {
    return parts.join("/");
  }
  return `${parts.slice(0, depth).join("/")}/**`;
};
