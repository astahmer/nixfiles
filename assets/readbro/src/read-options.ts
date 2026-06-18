import type { IrLayer } from "./ir.ts";

export type SymbolTarget = string | ReadonlyArray<string>;

export const normalizeTargets = (target?: SymbolTarget): Array<string> => {
  if (!target) return [];
  return typeof target === "string" ? [target] : [...target];
};

export type ReadbroReadOptions = {
  readonly layer?: IrLayer;
  readonly force?: boolean;
  readonly maxLines?: number;
  readonly offset?: number;
  readonly target?: SymbolTarget;
  readonly budget?: number;
  readonly full?: boolean;
};

export const resolveReadOptions = (options: ReadbroReadOptions = {}): ReadbroReadOptions => {
  if (options.full === true) {
    return {
      ...options,
      layer: options.layer ?? "L3",
      maxLines: -1,
    };
  }
  return options;
};
