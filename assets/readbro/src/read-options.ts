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
};
