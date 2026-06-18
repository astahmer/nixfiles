import { basename } from "node:path";
import type { IrLayer } from "./ir.ts";

export type SessionPathFetch = {
  readonly layer: IrLayer;
  readonly readOffset: number | null;
  readonly readMaxLines: number | null;
  readonly reads: number;
};

export type SessionPathStats = {
  readonly readCount: number;
  readonly fetches: ReadonlyArray<SessionPathFetch>;
};

export type ReadWindow = {
  readonly offset?: number;
  readonly maxLines?: number;
};

const formatWindow = (offset: number | null, maxLines: number | null): string => {
  if (offset === null && maxLines === null) {
    return "full";
  }
  if (maxLines !== null && maxLines < 0) {
    return "full";
  }
  const start = (offset ?? 0) + 1;
  if (maxLines === null || maxLines === undefined) {
    return `from line ${start}`;
  }
  const end = (offset ?? 0) + maxLines;
  return `lines ${start}–${end}`;
};

export const formatFetchedLayers = (fetches: ReadonlyArray<SessionPathFetch>): string => {
  if (fetches.length === 0) {
    return "none yet";
  }

  const byLayer = new Map<IrLayer, Array<string>>();
  for (const fetch of fetches) {
    const windows = byLayer.get(fetch.layer) ?? [];
    windows.push(formatWindow(fetch.readOffset, fetch.readMaxLines));
    byLayer.set(fetch.layer, windows);
  }

  return [...byLayer.entries()]
    .map(([layer, windows]) => `${layer} (${[...new Set(windows)].join(", ")})`)
    .join("; ");
};

export const formatRepeatPathNotice = (input: {
  readonly displayPath: string;
  readonly readNumber: number;
  readonly stats: SessionPathStats;
  readonly layer: IrLayer;
  readonly window?: ReadWindow;
}): string | null => {
  if (input.readNumber < 2) {
    return null;
  }

  const name = basename(input.displayPath);
  const lines = [
    `read #${input.readNumber} of ${name} this session`,
    `already fetched: ${formatFetchedLayers(input.stats.fetches)}`,
  ];

  if (input.window?.offset !== undefined || input.window?.maxLines !== undefined) {
    lines.push(
      `current window: ${formatWindow(input.window.offset ?? null, input.window.maxLines ?? null)}`,
    );
  }

  lines.push(
    '→ batch other files: read_file({ paths: ["a.ts", "b.ts"] }); for exact lines use around_line or ranges',
  );

  return lines.join("\n");
};
