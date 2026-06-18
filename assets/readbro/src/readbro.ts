import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { IrCacheStore } from "./cache.ts";
import type { CompostoIntent } from "./composto.ts";
import { runCompostoCli } from "./composto.ts";
import type { ReadbroError } from "./errors.ts";
import { toReadbroError } from "./errors.ts";
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
import type { ReadbroReadOptions } from "./read-options.ts";
import { findRepoRoot } from "./repo-root.ts";
import type { StatsRequest } from "./stats-query.ts";

export class Readbro extends Context.Tag("@readbro/Readbro")<
  Readbro,
  {
    readonly readFile: (path: string, options?: ReadbroReadOptions) => Effect.Effect<string, ReadbroError>;
    readonly readFiles: (
      paths: Array<string>,
      options?: ReadbroReadOptions,
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

    const readFile = (path: string, options: ReadbroReadOptions = {}) => {
      if (options.target) {
        return packContext({
          path,
          target: options.target,
          budget: options.budget,
        });
      }
      return Effect.sync(() => {
        logUsage("read", "read_file", path);
        const { maxLines, offset, force, layer } = options;
        const result = cache.readFile(path, { layer, force });
        return formatReadResult(result, cache.getStats({ scope: "repo" }), {
          maxLines,
          offset,
        });
      });
    };

    const readFiles = (paths: Array<string>, options: ReadbroReadOptions = {}) =>
      Effect.sync(() => {
        logUsage("reads", "read_files", paths.join(" "));
        const { maxLines, offset, force, layer } = options;
        const parts = paths.map((path) => {
          const result = cache.readFile(path, { layer, force });
          return `=== ${path} ===\n${formatReadResult(result, { savedTokens: 0 }, {
            showFooter: false,
            maxLines,
            offset,
          })}`;
        });
        const stats = cache.getStats({ scope: "repo" });
        let footer = "";
        if (stats.savedTokens > 0) {
          footer = `\n\n[~${stats.savedTokens.toLocaleString()} tokens saved in repo cache]`;
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
          logUsage(
            "context",
            "pack_context",
            [options.path ?? ".", options.target].filter(Boolean).join(" "),
          );
          const abs = resolve(options.path ?? ".");
          const root = findRepoRoot(abs);
          let isFile = false;
          try {
            isFile = statSync(abs).isFile();
          } catch {
            // path may not exist yet; composto will surface the error
          }
          if (isFile && !options.target) {
            throw new Error(
              "pack_context: path is a file — pass target (symbol/class name). composto context scans from repo root, not a single file path.",
            );
          }
          const contextPath = isFile ? root : abs;
          const args = ["context", contextPath, `--budget=${options.budget ?? 4000}`];
          if (options.target) args.push(`--target=${options.target}`);
          return runCompostoCli(args, root);
        },
        catch: toReadbroError,
      });

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
      readFiles,
      packContext,
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
