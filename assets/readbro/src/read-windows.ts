import { generatePayload } from "./ir.ts";
import type { ReadbroReadOptions } from "./read-options.ts";

/** 1-based inclusive line range. */
export type NumericRange = readonly [number, number];

export type ResolvedReadWindows = ReadbroReadOptions & {
  readonly numericRanges?: ReadonlyArray<NumericRange>;
  readonly symbolNames?: ReadonlyArray<string>;
  readonly sliceContent: boolean;
};

const DEFAULT_CONTEXT = 40;

export const aroundLineToRange = (line: number, context = DEFAULT_CONTEXT): NumericRange => {
  const center = Math.max(1, Math.floor(line));
  return [Math.max(1, center - context), center + context];
};

export const parseRangeEntry = (entry: unknown): { kind: "numeric"; range: NumericRange } | { kind: "symbol"; name: string } | null => {
  if (typeof entry === "string" && entry.length > 0) {
    return { kind: "symbol", name: entry };
  }
  if (Array.isArray(entry)) {
    if (entry.length === 2 && typeof entry[0] === "number" && typeof entry[1] === "number") {
      const start = Math.max(1, Math.floor(entry[0]));
      const end = Math.max(start, Math.floor(entry[1]));
      return { kind: "numeric", range: [start, end] };
    }
    if (entry.length === 2 && typeof entry[0] === "string" && typeof entry[1] === "string") {
      const start = Number(entry[0]);
      const end = Number(entry[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return { kind: "numeric", range: [Math.max(1, start), Math.max(start, end)] };
      }
    }
  }
  return null;
};

export const parseRangesInput = (
  ranges: ReadonlyArray<unknown> | undefined,
): { numeric: Array<NumericRange>; symbols: Array<string> } => {
  const numeric: Array<NumericRange> = [];
  const symbols: Array<string> = [];
  if (!ranges) {
    return { numeric, symbols };
  }
  for (const entry of ranges) {
    const parsed = parseRangeEntry(entry);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "numeric") {
      numeric.push(parsed.range);
    } else {
      symbols.push(parsed.name);
    }
  }
  return { numeric, symbols };
};

const SYMBOL_LINE_RE =
  /^(?:FN|CLASS|METHOD|TYPE|OUT TYPE|OUT CLASS|VAR):\s*(\S+)\s+L(\d+)\b/gm;

export const findSymbolLineInL0 = (l0Text: string, symbol: string): number | null => {
  const want = symbol.trim();
  if (!want) {
    return null;
  }

  let fallback: number | null = null;
  for (const match of l0Text.matchAll(SYMBOL_LINE_RE)) {
    const name = match[1]!;
    const line = Number(match[2]);
    if (!Number.isFinite(line)) {
      continue;
    }
    if (name === want) {
      return line;
    }
    if (name.toLowerCase() === want.toLowerCase()) {
      fallback = line;
    }
    if (fallback === null && (name.includes(want) || want.includes(name))) {
      fallback = line;
    }
  }
  return fallback;
};

export const resolveSymbolRanges = (
  absPath: string,
  symbols: ReadonlyArray<string>,
  context = DEFAULT_CONTEXT,
): Array<NumericRange> => {
  if (symbols.length === 0) {
    return [];
  }
  const { payload } = generatePayload(absPath, "L0");
  const ranges: Array<NumericRange> = [];
  for (const symbol of symbols) {
    const line = findSymbolLineInL0(payload, symbol);
    if (line !== null) {
      ranges.push(aroundLineToRange(line, context));
    }
  }
  return ranges;
};

export const resolveReadWindows = (options: ReadbroReadOptions = {}): ResolvedReadWindows => {
  const context = options.context ?? DEFAULT_CONTEXT;
  let base = { ...options };

  if (options.full === true) {
    base = {
      ...base,
      layer: base.layer ?? "L3",
      maxLines: -1,
    };
  }

  const parsed = parseRangesInput(options.ranges as ReadonlyArray<unknown> | undefined);
  const numeric: Array<NumericRange> = [...parsed.numeric];

  if (options.around_line !== undefined) {
    numeric.push(aroundLineToRange(options.around_line, context));
    base = { ...base, layer: base.layer ?? "L3" };
  }

  if (numeric.length > 0 || parsed.symbols.length > 0) {
    base = { ...base, layer: base.layer ?? "L3" };
  }

  const sliceContent =
    numeric.length > 0 ||
    parsed.symbols.length > 0 ||
    options.around_line !== undefined ||
    (options.ranges !== undefined && options.ranges.length > 0);

  return {
    ...base,
    numericRanges: numeric.length > 0 ? numeric : undefined,
    symbolNames: parsed.symbols.length > 0 ? parsed.symbols : undefined,
    sliceContent,
  };
};

export const mergeSymbolRanges = (
  absPath: string,
  resolved: ResolvedReadWindows,
): ReadonlyArray<NumericRange> => {
  const numeric = [...(resolved.numericRanges ?? [])];
  if (resolved.symbolNames && resolved.symbolNames.length > 0) {
    numeric.push(...resolveSymbolRanges(absPath, resolved.symbolNames, resolved.context ?? DEFAULT_CONTEXT));
  }
  return numeric;
};
