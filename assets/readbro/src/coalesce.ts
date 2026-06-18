import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { ReadbroError } from "./errors.ts";
import { Readbro } from "./readbro.ts";
import type { ReadbroReadOptions } from "./read-options.ts";
import { normalizeTargets } from "./read-options.ts";

type ReadbroApi = Context.Tag.Service<typeof Readbro>;

type PendingRead = {
  readonly path: string;
  readonly options: ReadbroReadOptions;
  readonly resolve: (value: string) => void;
  readonly reject: (error: ReadbroError) => void;
};

type CoalesceGroup = {
  readonly key: string;
  readonly options: ReadbroReadOptions;
  items: Array<PendingRead>;
};

const COALESCE_MS = 50;

let pending: Array<PendingRead> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const isCoalescable = (options: ReadbroReadOptions): boolean =>
  normalizeTargets(options.target).length === 0 &&
  options.offset === undefined &&
  options.around_line === undefined &&
  (options.ranges === undefined || options.ranges.length === 0) &&
  options.force !== true;

const groupKey = (options: ReadbroReadOptions): string =>
  JSON.stringify({
    layer: options.layer ?? "L1",
    force: options.force ?? false,
    maxLines: options.maxLines ?? null,
    full: options.full ?? false,
    budget: options.budget ?? null,
  });

const splitBatchChunk = (text: string, path: string): string => {
  const marker = `=== ${path} ===\n`;
  const start = text.indexOf(marker);
  if (start === -1) {
    return text;
  }
  const bodyStart = start + marker.length;
  const next = text.indexOf("\n\n=== ", bodyStart);
  const chunk = next === -1 ? text.slice(bodyStart) : text.slice(bodyStart, next);
  const footerMatch = chunk.match(/\n\n\[~[\d,]+ tokens saved in repo cache\]$/);
  return footerMatch ? chunk.slice(0, footerMatch.index) : chunk;
};

const flush = async (rb: ReadbroApi): Promise<void> => {
  const batch = pending;
  pending = [];
  flushTimer = null;
  if (batch.length === 0) {
    return;
  }

  const groups = new Map<string, CoalesceGroup>();
  for (const item of batch) {
    if (!isCoalescable(item.options)) {
      const soloKey = `solo:${item.path}:${groupKey(item.options)}:${Date.now()}:${Math.random()}`;
      groups.set(soloKey, { key: soloKey, options: item.options, items: [item] });
      continue;
    }

    const key = groupKey(item.options);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, options: item.options, items: [item] });
    }
  }

  for (const group of groups.values()) {
    const uniquePaths = [...new Set(group.items.map((item) => item.path))];
    try {
      if (uniquePaths.length === 1) {
        const output = await Effect.runPromise(rb.readFile(uniquePaths[0]!, group.options));
        for (const item of group.items) {
          item.resolve(output);
        }
        continue;
      }

      const output = await Effect.runPromise(rb.readFile(uniquePaths, group.options));
      for (const item of group.items) {
        item.resolve(splitBatchChunk(output, item.path));
      }
    } catch (error) {
      const readbroError = error as ReadbroError;
      for (const item of group.items) {
        item.reject(readbroError);
      }
    }
  }
};

export const coalescedReadFile = (
  rb: ReadbroApi,
  path: string | ReadonlyArray<string>,
  options: ReadbroReadOptions = {},
): Effect.Effect<string, ReadbroError> => {
  if (typeof path !== "string" || !isCoalescable(options)) {
    return rb.readFile(path, options);
  }

  return Effect.async<string, ReadbroError>((resume) => {
    pending.push({
      path,
      options,
      resolve: (value) => {
        resume(Effect.succeed(value));
      },
      reject: (error) => {
        resume(Effect.fail(error));
      },
    });

    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        void flush(rb);
      }, COALESCE_MS);
    }
  });
};

export const resetReadCoalescer = (): void => {
  pending = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
};
