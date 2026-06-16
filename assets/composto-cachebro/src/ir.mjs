import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
]);

export function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function findRepoRoot(filePath) {
  let dir = resolve(filePath);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = dirname(dir);
  }
  return dirname(resolve(filePath));
}

export function estimateTokens(text) {
  return Math.ceil(text.length * 0.75);
}

export function generatePayload(absPath, layer) {
  const source = readFileSync(absPath, "utf-8");
  const sourceHash = contentHash(source);
  const ext = absPath.slice(absPath.lastIndexOf(".")).toLowerCase();

  if (layer === "L3") {
    return { payload: source, sourceHash, representation: "raw" };
  }

  if (!CODE_EXT.has(ext)) {
    return { payload: source, sourceHash, representation: "raw-fallback" };
  }

  const repoRoot = findRepoRoot(absPath);
  const relPath = relative(repoRoot, absPath);
  const result = spawnSync("composto", ["ir", relPath, layer], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 60_000,
  });

  const ir = result.stdout?.trim() ?? "";
  if (result.status === 0 && ir.length > 0) {
    return { payload: ir, sourceHash, representation: "ir" };
  }

  return { payload: source, sourceHash, representation: "raw-fallback" };
}
