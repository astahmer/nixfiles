import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolve } from "node:path";
import { IrCacheStore } from "./cache.ts";
import type { CompostoIntent } from "./composto.ts";
import { runCompostoCli } from "./composto.ts";
import type { ReadbroError } from "./errors.ts";
import { toReadbroError } from "./errors.ts";
import { formatGain, formatReadResult, formatStats } from "./format.ts";
import type { IrLayer } from "./ir.ts";

export class Readbro extends Context.Tag("@readbro/Readbro")<
  Readbro,
  {
    readonly readFile: (
      path: string,
      options?: { readonly layer?: IrLayer; readonly force?: boolean },
    ) => Effect.Effect<string>;
    readonly readFiles: (
      paths: Array<string>,
      options?: { readonly layer?: IrLayer },
    ) => Effect.Effect<string>;
    readonly packContext: (options: {
      readonly path?: string;
      readonly budget?: number;
      readonly target?: string;
    }) => Effect.Effect<string, ReadbroError>;
    readonly blastRadius: (
      file: string,
      intent?: CompostoIntent,
    ) => Effect.Effect<string, ReadbroError>;
    readonly stats: () => Effect.Effect<string>;
    readonly gain: () => Effect.Effect<string>;
    readonly clear: (path?: string) => Effect.Effect<string>;
  }
>() {}

const make = Effect.sync(() => {
  const cache = new IrCacheStore();

  const readFile = (
    path: string,
    options?: { readonly layer?: IrLayer; readonly force?: boolean },
  ) =>
    Effect.sync(() => {
      const result = cache.readFile(path, options);
      return formatReadResult(result, cache.getStats());
    });

  const readFiles = (paths: Array<string>, options?: { readonly layer?: IrLayer }) =>
    Effect.sync(() => {
      const parts = paths.map((path) => {
        const result = cache.readFile(path, options);
        return `=== ${path} ===\n${formatReadResult(result, { repoTokensSaved: 0 }, false)}`;
      });
      const stats = cache.getStats();
      let footer = "";
      if (stats.repoTokensSaved > 0) {
        footer = `\n\n[~${stats.repoTokensSaved.toLocaleString()} tokens saved in repo cache]`;
      }
      return parts.join("\n\n") + footer;
    });

  const packContext = (options: {
    readonly path?: string;
    readonly budget?: number;
    readonly target?: string;
  }) =>
    Effect.try({
      try: () => {
        const abs = resolve(options.path ?? ".");
        const args = ["context", abs, `--budget=${options.budget ?? 4000}`];
        if (options.target) args.push(`--target=${options.target}`);
        return runCompostoCli(args, abs);
      },
      catch: toReadbroError,
    });

  const blastRadius = (file: string, intent?: CompostoIntent) =>
    Effect.try({
      try: () => {
        const abs = resolve(file);
        const args = ["impact", abs];
        if (intent) args.push(`--intent=${intent}`);
        return runCompostoCli(args, abs);
      },
      catch: toReadbroError,
    });

  const stats = () => Effect.sync(() => formatStats(cache.getStats()));

  const gain = () => Effect.sync(() => formatGain(cache.getStats()));

  const clear = (path?: string) =>
    Effect.sync(() => {
      cache.clear(path);
      return path
        ? `Cache cleared for ${resolve(path)} working copy.`
        : "Cache cleared for all open repo databases.";
    });

  return {
    readFile,
    readFiles,
    packContext,
    blastRadius,
    stats,
    gain,
    clear,
  } satisfies Context.Tag.Service<Readbro>;
});

export const ReadbroLive = Layer.effect(Readbro, make);
