import type { IrLayer, Representation } from "./ir.ts";

export type LineWindow = {
  readonly offset?: number;
  readonly maxLines?: number;
};

export type LineWindowResult = {
  readonly text: string;
  readonly totalLines: number;
  readonly shownFrom: number;
  readonly shownTo: number;
  readonly truncated: boolean;
};

const parseCap = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const defaultRawMaxLines = (): number => parseCap(process.env.READBRO_L3_MAX_LINES, 200);

export const effectiveMaxLines = (input: {
  readonly layer: IrLayer;
  readonly representation: Representation;
  readonly maxLines?: number;
}): number | undefined => {
  if (input.maxLines !== undefined) {
    return input.maxLines < 0 ? undefined : input.maxLines;
  }
  if (input.layer === "L3" || input.representation === "raw") {
    const cap = defaultRawMaxLines();
    return cap > 0 ? cap : undefined;
  }
  return undefined;
};

export const applyLineWindow = (text: string, window: LineWindow = {}): LineWindowResult => {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const offset = Math.max(0, window.offset ?? 0);
  const maxLines = window.maxLines;

  if (maxLines === undefined || maxLines < 0 || totalLines === 0) {
    return {
      text,
      totalLines,
      shownFrom: 1,
      shownTo: totalLines,
      truncated: false,
    };
  }

  const slice = lines.slice(offset, offset + maxLines);
  const shownFrom = slice.length > 0 ? offset + 1 : 0;
  const shownTo = offset + slice.length;
  const truncated = offset > 0 || shownTo < totalLines;

  return {
    text: slice.join("\n"),
    totalLines,
    shownFrom,
    shownTo,
    truncated,
  };
};

export const lineWindowNotice = (result: LineWindowResult): string | null => {
  if (!result.truncated) {
    return null;
  }
  return `[readbro: showing lines ${result.shownFrom}-${result.shownTo} of ${result.totalLines} — use L1 for behaviour IR, or max_lines: -1 for full raw]`;
};
