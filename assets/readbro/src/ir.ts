import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { generateMdIr, MD_EXT } from "./md-ir.ts";
import { findRepoRoot } from "./repo-root.ts";

export type IrLayer = "L0" | "L1" | "L2" | "L3";

export type Representation = "raw" | "raw-fallback" | "ir" | "md-ir";

/** Extensions with no readbro compressor — L1 returns raw with an advisory. */
export const NON_CODE_EXT = new Set([
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".nix",
  ".sql",
  ".sh",
  ".env",
]);

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

export const contentHash = (content: string): string =>
  createHash("sha256").update(content).digest("hex").slice(0, 16);

export const estimateTokens = (text: string): number => Math.ceil(text.length * 0.75);

export type IrPayload = {
  readonly payload: string;
  readonly sourceHash: string;
  readonly representation: Representation;
  readonly durationMs: number;
};

export const generatePayload = (absPath: string, layer: IrLayer): IrPayload => {
  const started = performance.now();
  const source = readFileSync(absPath, "utf-8");
  const sourceHash = contentHash(source);
  const dot = absPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : absPath.slice(dot).toLowerCase();

  const finish = (payload: string, representation: Representation): IrPayload => ({
    payload,
    sourceHash,
    representation,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
  });

  if (layer === "L3") {
    return finish(source, "raw");
  }

  if (MD_EXT.has(ext)) {
    const mdLayer = layer === "L2" ? "L1" : layer;
    return finish(generateMdIr(source, mdLayer, absPath), "md-ir");
  }

  if (!CODE_EXT.has(ext)) {
    return finish(source, "raw-fallback");
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
    return finish(ir, "ir");
  }

  return finish(source, "raw-fallback");
};
