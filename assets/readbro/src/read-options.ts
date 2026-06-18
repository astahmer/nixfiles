import type { IrLayer } from "./ir.ts";

export type SymbolTarget = string | ReadonlyArray<string>;

export const normalizeTargets = (target?: SymbolTarget): Array<string> => {
  if (!target) return [];
  return typeof target === "string" ? [target] : [...target];
};

export type RangeInput =
  | readonly [number, number]
  | readonly [string, string]
  | string
  | ReadonlyArray<number | string>;

export type ReadbroReadOptions = {
  readonly layer?: IrLayer;
  readonly force?: boolean;
  readonly maxLines?: number;
  readonly offset?: number;
  readonly target?: SymbolTarget;
  readonly budget?: number;
  readonly full?: boolean;
  readonly around_line?: number;
  readonly context?: number;
  readonly ranges?: ReadonlyArray<RangeInput>;
};

export { resolveReadWindows as resolveReadOptions, type ResolvedReadWindows } from "./read-windows.ts";
