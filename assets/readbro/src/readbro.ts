import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { IrCacheStore } from "./cache.ts";
import type { CompostoIntent } from "./composto.ts";
import { runCompostoCli } from "./composto.ts";
import type { ReadbroError } from "./errors.ts";
import { ReadbroUnknownError, toReadbroError } from "./errors.ts";
import {
  formatClearResult,
  formatGain,
  formatReadResult,
  formatSessionsList,
  formatStats,
  formatUsageList,
} from "./format.ts";
import { doctorExitCode, formatDoctor, runDoctor } from "./doctor.ts";
import type { ClearOptions, HistoryFormat, SessionsQuery, UsageQuery } from "./history-query.ts";
import type { ReadbroReadOptions, SymbolTarget } from "./read-options.ts";
import { normalizeTargets } from "./read-options.ts";
import { findRepoRoot } from "./repo-root.ts";
import type { StatsRequest } from "./stats-query.ts";

export type SearchSymbolOptions = {
  readonly path?: string;
  readonly budget?: number;
  readonly target?: SymbolTarget;
};

export class Readbro extends Context.Tag("@readbro/Readbro")<
  Readbro,
  {
    readonly readFile: (
      path: string | ReadonlyArray<string>,
      options?: ReadbroReadOptions,
    ) => Effect.Effect<string, ReadbroError>;
    readonly searchSymbol: (options: SearchSymbolOptions) => Effect.Effect<string, ReadbroError>;
    readonly blastRadius: (
      file: string,
      intent?: CompostoIntent,
    ) => Effect.Effect<string, ReadbroError>;
    readonly stats: (request?: StatsRequest) => Effect.Effect<string>;
    readonly gain: (request?: StatsRequest) => Effect.Effect<string>;
    readonly clear: (options?: ClearOptions) => Effect.Effect<string>;
    readonly ls: (query?: UsageQuery, format?: HistoryFormat) => Effect.Effect<string>;
    readonly sessions: (
      query?: SessionsQuery,
      format?: HistoryFormat,
    ) => Effect.Effect<string>;
    readonly doctor: (options?: { readonly path?: string; readonly json?: boolean }) => Effect.Effect<string>;
  }
>() {}

const make = (usageSource: "cli" | "mcp" = "cli") =>
  Effect.sync(() => {
    const cache = new IrCacheStore({ usageSource });

    const logUsage = (cliName: string, mcpName?: string, detail?: string) => {
      cache.logUsage(usageSource === "mcp" ? (mcpName ?? cliName) : cliName, detail);
    };

    const readOneFile = (path: string, options: ReadbroReadOptions) => {
      const { maxLines, offset, force, layer } = options;
      const result = cache.readFile(path, { layer, force });
      return formatReadResult(result, cache.getStats({ scope: "repo" }), {
        maxLines,
        offset,
        showFooter: false,
      });
    };

    const resolveSearchTargets = (options: SearchSymbolOptions): Array<string> =>
      normalizeTargets(options.target);

    const searchSymbol = (options: SearchSymbolOptions) =>
      Effect.try({
        try: () => {
          const targets = resolveSearchTargets(options);
          const detail = [options.path ?? ".", ...targets].filter(Boolean).join(" ");
          logUsage("symbol", "search_symbol", detail);

          const abs = resolve(options.path ?? ".");
          const root = findRepoRoot(abs);
          let isFile = false;
          try {
            isFile = statSync(abs).isFile();
          } catch {
            // path may not exist yet; composto will surface the error
          }
          if (isFile && targets.length === 0) {
            throw new Error(
              "search_symbol: path is a file — pass target (symbol/class name). composto context scans from repo root, not a single file path alone.",
            );
          }

          const contextPath = isFile ? root : abs;
          const budget = options.budget ?? 4000;

          if (targets.length === 0) {
            return runCompostoCli(["context", contextPath, `--budget=${budget}`], root);
          }

          if (targets.length === 1) {
            return runCompostoCli(
              ["context", contextPath, `--budget=${budget}`, `--target=${targets[0]}`],
              root,
            );
          }

          const perTargetBudget = Math.max(500, Math.floor(budget / targets.length));
          const parts = targets.map((target) => {
            const output = runCompostoCli(
              ["context", contextPath, `--budget=${perTargetBudget}`, `--target=${target}`],
              root,
            );
            return `=== ${target} ===\n${output}`;
          });
          return parts.join("\n\n");
        },
        catch: toReadbroError,
      });

    const hasSearchTarget = (options: ReadbroReadOptions) =>
      normalizeTargets(options.target).length > 0;

    const readFile = (path: string | ReadonlyArray<string>, options: ReadbroReadOptions = {}) => {
      if (hasSearchTarget(options)) {
        const paths = typeof path === "string" ? [path] : [...path];
        if (paths.length > 1) {
          return Effect.fail(
            new ReadbroUnknownError({
              cause: new Error(
                "read_file: target cannot be combined with a path array — use search_symbol or a single path",
              ),
            }),
          );
        }
        return searchSymbol({
          path: paths[0],
          target: options.target,
          budget: options.budget,
        });
      }

      const paths = typeof path === "string" ? [path] : [...path];
      return Effect.sync(() => {
        const detail = paths.join(" ");
        logUsage(paths.length === 1 ? "read" : "reads", "read_file", detail);

        if (paths.length === 1) {
          const { maxLines, offset, force, layer } = options;
          const result = cache.readFile(paths[0]!, { layer, force });
          return formatReadResult(result, cache.getStats({ scope: "repo" }), {
            maxLines,
            offset,
          });
        }

        const parts = paths.map((filePath) => `=== ${filePath} ===\n${readOneFile(filePath, options)}`);
        const stats = cache.getStats({ scope: "repo" });
        let footer = "";
        if (stats.savedTokens > 0) {
          footer = `\n\n[~${stats.savedTokens.toLocaleString()} tokens saved in repo cache]`;
        }
        return parts.join("\n\n") + footer;
      });
    };

    const blastRadius = (file: string, intent?: CompostoIntent) =>
      Effect.try({
        try: () => {
          logUsage("blast", "blast_radius", intent ? `${file} (${intent})` : file);
          const abs = resolve(file);
          const args = ["impact", abs];
          if (intent) args.push(`--intent=${intent}`);
          return runCompostoCli(args, abs);
        },
        catch: toReadbroError,
      });

    const stats = (request?: StatsRequest) =>
      Effect.sync(() => {
        logUsage("stats", "session_status");
        return formatStats(cache.getStats(request?.query), request?.format);
      });

    const gain = (request?: StatsRequest) =>
      Effect.sync(() => {
        logUsage("gain", "session_gain");
        return formatGain(cache.getStats(request?.query), request?.format);
      });

    const clear = (options: ClearOptions = {}) =>
      Effect.sync(() => {
        logUsage("clear", "session_clear", options.path);
        const result = cache.clear(options);
        return formatClearResult(result, options.path ? resolve(options.path) : undefined);
      });

    const ls = (query: UsageQuery = {}, format: HistoryFormat = {}) =>
      Effect.sync(() => {
        logUsage("ls");
        return formatUsageList(cache.listUsage(query), format);
      });

    const sessions = (query: SessionsQuery = {}, format: HistoryFormat = {}) =>
      Effect.sync(() => {
        logUsage("sessions");
        return formatSessionsList(cache.listSessions(query), format);
      });

    const doctor = (options: { readonly path?: string; readonly json?: boolean } = {}) =>
      Effect.sync(() => {
        logUsage("doctor");
        const report = runDoctor({ anchorPath: options.path });
        if (!report.ok) {
          process.exitCode = doctorExitCode(report);
        }
        return formatDoctor(report, options.json);
      });

    return {
      readFile,
      searchSymbol,
      blastRadius,
      stats,
      gain,
      clear,
      ls,
      sessions,
      doctor,
    } satisfies Context.Tag.Service<Readbro>;
  });

export const ReadbroLive = Layer.effect(Readbro, make("cli"));
export const ReadbroLiveMcp = Layer.effect(Readbro, make("mcp"));
