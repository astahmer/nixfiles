import type { IrLayer } from "./ir.ts";

export type ReadbroReadOptions = {
  readonly layer?: IrLayer;
  readonly force?: boolean;
  readonly maxLines?: number;
  readonly offset?: number;
  readonly target?: string;
  readonly budget?: number;
};
