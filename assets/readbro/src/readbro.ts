import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { IrCacheStore } from "./cache.ts";
import type { CompostoIntent } from "./composto.ts";
import { runCompostoCli, runCompostoCliAll, runCompostoCliAsync } from "./composto.ts";
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
import { normalizeTargets, resolveReadOptions, type ResolvedReadWindows } from "./read-options.ts";
import { mergeSymbolRanges } from "./read-windows.ts";
import { findRepoRoot } from "./repo-root.ts";
import type { StatsRequest } from "./stats-query.ts";
import { formatSessionAudit, runSessionAudit } from "./audit.ts";
import { guardSymbolOutput } from "./symbol-guard.ts";
import type { NumericRange } from "./read-windows.ts";

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
    readonly audit: (options?: {
      readonly path?: string;
      readonly sessionId?: string;
      readonly json?: boolean;
    }) => Effect.Effect<string>;
  }
>() {}

const make = (usageSource: "cli" | "mcp" = "cli") =>
  Effect.sync(() => {
    const cache = new IrCacheStore({ usageSource });

    const logUsage = (cliName: string, mcpName?: string, detail?: string) => {
      cache.logUsage(usageSource === "mcp" ? (mcpName ?? cliName) : cliName, detail);
    };

    const formatSliceOptions = (
      filePath: string,
      options: ReadbroReadOptions,
      showFooter: boolean,
    ): string => {
      const resolved = resolveReadOptions(options);
      const abs = resolve(filePath);
      const numericRanges: ReadonlyArray<NumericRange> = mergeSymbolRanges(abs, resolved);
      const sliceContent = resolved.sliceContent || numericRanges.length > 0;
      const { maxLines, offset, force, layer } = resolved;
      const priorStats = cache.getSessionPathStats(filePath);
      const result = cache.readFile(filePath, {
        layer,
        force: force || sliceContent,
        offset: numericRanges.length > 0 ? undefined : offset,
        maxLines: numericRanges.length > 0 ? undefined : maxLines,
      });
      return formatReadResult(result, cache.getStats({ scope: "repo" }), {
        maxLines,
        offset,
        numericRanges: numericRanges.length > 0 ? numericRanges : undefined,
        filePath,
        sessionReadNumber: priorStats.readCount + 1,
        sessionPathStats: priorStats,
        showFooter,
      });
    };

    const readOneFile = (path: string, options: ReadbroReadOptions) =>
      formatSliceOptions(path, options, false);

    const hasSliceWindows = (resolved: ResolvedReadWindows): boolean =>
      resolved.sliceContent === true;

    const hasSearchTarget = (options: ReadbroReadOptions) =>
      normalizeTargets(options.target).length > 0;

    const runSearchSymbol = (options: SearchSymbolOptions) =>
      Effect.tryPromise({
        try: async () => {
          const targets = normalizeTargets(options.target);
          const detail = [options.path ?? ".", ...targets].filter(Boolean).join(" ");
          logUsage("symbol", "search_symbol", detail);

          const abs = resolve(options.path ?? ".");
          const root = findRepoRoot(abs);
          let isFile = false;
          let isDirectory = false;
          try {
            const st = statSync(abs);
            isFile = st.isFile();
            isDirectory = st.isDirectory();
          } catch {
            // path may not exist yet; composto will surface the error
          }
          if (isDirectory && targets.length === 0) {
            throw new Error(
              "search_symbol: path is a directory — pass target (symbol name), or use read_file with a path array to batch-read files",
            );
          }
          if (isFile && targets.length === 0) {
            throw new Error(
              "search_symbol: path is a file — pass target (symbol/class name). composto context scans from repo root, not a single file path alone.",
            );
          }

          const contextPath = isFile ? root : abs;
          const budget = options.budget ?? 4000;

          if (targets.length === 0) {
            const output = runCompostoCli(["context", contextPath, `--budget=${budget}`], root);
            return guardSymbolOutput(output, budget, targets);
          }

          if (targets.length === 1) {
            const output = await runCompostoCliAsync(
              ["context", contextPath, `--budget=${budget}`, `--target=${targets[0]}`],
              root,
            );
            return guardSymbolOutput(output, budget, targets);
          }

          const outputs = await runCompostoCliAll(
            targets.map((target) => ({
              args: ["context", contextPath, `--budget=${budget}`, `--target=${target}`],
              startPath: root,
            })),
          );
          const joined = targets
            .map((target, index) => `=== ${target} ===\n${outputs[index] ?? ""}`)
            .join("\n\n");
          return guardSymbolOutput(joined, budget, targets);
        },
        catch: toReadbroError,
      });

    const searchSymbol = (options: SearchSymbolOptions) =>
      runSearchSymbol(options);

    const readFile = (path: string | ReadonlyArray<string>, options: ReadbroReadOptions = {}) => {
      const resolved = resolveReadOptions(options);
      if (hasSearchTarget(resolved) && hasSliceWindows(resolved)) {
        return Effect.fail(
          new ReadbroUnknownError({
            cause: new Error(
              "read_file: target cannot be combined with around_line/ranges — use search_symbol or line windows separately",
            ),
          }),
        );
      }
      if (hasSearchTarget(resolved)) {
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
          target: resolved.target,
          budget: resolved.budget,
        });
      }

      const paths = typeof path === "string" ? [path] : [...path];
      return Effect.sync(() => {
        for (const filePath of paths) {
          const abs = resolve(filePath);
          try {
            if (statSync(abs).isDirectory()) {
              throw new Error(
                `read_file: ${filePath} is a directory — pass file paths, not folders. Batch files in one call: read_file({ path: ["a.ts", "b.ts"] }). Use search_symbol for symbol lookup across a tree.`,
              );
            }
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("read_file:")) {
              throw error;
            }
            // missing path — generatePayload / composto will report it
          }
        }

        const detail = paths.join(" ");
        logUsage(paths.length === 1 ? "read" : "read", "read_file", detail);

        if (paths.length === 1) {
          return formatSliceOptions(paths[0]!, options, true);
        }

        const parts = paths.map((filePath) => `=== ${filePath} ===\n${readOneFile(filePath, resolved)}`);
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

    const audit = (options: { readonly path?: string; readonly sessionId?: string; readonly json?: boolean } = {}) =>
      Effect.sync(() => {
        logUsage("audit");
        const report = runSessionAudit(cache, {
          anchorPath: options.path,
          sessionId: options.sessionId,
        });
        return formatSessionAudit(report, options.json);
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
      audit,
    } satisfies Context.Tag.Service<Readbro>;
  });

export const ReadbroLive = Layer.effect(Readbro, make("cli"));
export const ReadbroLiveMcp = Layer.effect(Readbro, make("mcp"));
