import { NodeSink, NodeStream } from "@effect/platform-node";
import * as McpSchema from "@effect/ai/McpSchema";
import * as McpServer from "@effect/ai/McpServer";
import * as Effect from "effect/Effect";
import * as JSONSchema from "effect/JSONSchema";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import type { ReadbroError } from "./errors.ts";
import { ReadbroUnknownError } from "./errors.ts";
import { coalescedReadFile } from "./coalesce.ts";
import { Readbro, ReadbroLiveMcp } from "./readbro.ts";
import type { ReadbroReadOptions } from "./read-options.ts";
import { appendMcpFooter } from "./tips.ts";
import { statsRequestFromMcp } from "./stats-query.ts";

const textResult = (text: string, isError = false) =>
  new McpSchema.CallToolResult({
    isError,
    content: [{ type: "text", text }],
  });

const errorResult = (error: ReadbroError) => textResult(`Error: ${error.message}`, true);

const LayerSchema = Schema.Literal("L0", "L1", "L2", "L3");
const IntentSchema = Schema.Literal(
  "refactor",
  "bugfix",
  "feature",
  "test",
  "docs",
  "unknown",
);

const PathSchema = Schema.Union(Schema.String, Schema.Array(Schema.String));
const TargetSchema = Schema.Union(Schema.String, Schema.Array(Schema.String));

const ReadFileSchema = Schema.Struct({
  path: Schema.optional(PathSchema),
  paths: Schema.optional(PathSchema),
  layer: Schema.optional(LayerSchema),
  force: Schema.optional(Schema.Boolean),
  full: Schema.optional(Schema.Boolean),
  max_lines: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  around_line: Schema.optional(Schema.Number),
  context: Schema.optional(Schema.Number),
  ranges: Schema.optional(Schema.Array(Schema.Unknown)),
  target: Schema.optional(TargetSchema),
  budget: Schema.optional(Schema.Number),
});

const SearchSymbolSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  budget: Schema.optional(Schema.Number),
  target: Schema.optional(TargetSchema),
});

const StatsFilterSchema = Schema.Struct({
  scope: Schema.optional(Schema.Literal("repo", "session")),
  since: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String),
  discover_globs: Schema.optional(Schema.Number),
  json: Schema.optional(Schema.Boolean),
  verbose: Schema.optional(Schema.Boolean),
});

const registerTool = (
  name: string,
  description: string,
  parameters: Schema.Schema.Any | null,
  run: (payload: unknown) => Effect.Effect<string, ReadbroError>,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const inputSchema =
      parameters === null
        ? ({
            type: "object",
            properties: {},
            additionalProperties: false,
          } as McpSchema.Tool["inputSchema"])
        : (JSONSchema.make(parameters) as McpSchema.Tool["inputSchema"]);
    const tool = new McpSchema.Tool({
      name,
      description,
      inputSchema,
    });

    yield* server.addTool({
      tool,
      handle: (payload) =>
        run(payload).pipe(
          Effect.map((text) => textResult(appendMcpFooter(name, payload, text))),
          Effect.catchAll((error) => Effect.succeed(errorResult(error))),
        ),
    });
  });

export const McpLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const rb = yield* Readbro;

    yield* registerTool(
      "read_file",
      [
        "PLAN FIRST: list files you will touch, then read_file({ paths: [...], layer: \"L1\" }) in ONE call.",
        "Parallel read_file tool calls ≠ batch — only a path array in one call saves round-trips and tokens.",
        "Read one or more files via composto IR + repo cache. ALWAYS use instead of built-in Read.",
        "PRECISE LOOKUP: if you know a symbol name, pass target (delegates to search_symbol) — do NOT grep or read whole file at L1 first.",
        "path/paths: string OR array — batch multiple files in ONE call (never parallel read_file). target requires a single path.",
        "After edits: prefer around_line or ranges for exact lines — not force on whole files.",
        "Directories are rejected — pass file paths. Use search_symbol for symbol lookup across a tree.",
        "Exploratory reads (no symbol): DEFAULT layer L1. L0=structure survey. Do NOT use L3 for exploration.",
        "L3/raw auto-truncates to READBRO_L3_MAX_LINES (default 200); full: true or max_lines: -1 for full raw.",
        "Line windows: around_line (+ optional context), or ranges: [[start,end], ...] or symbol names resolved via L0.",
      ].join(" "),
      ReadFileSchema,
      (payload) => {
        const p = payload as {
          path?: string | Array<string>;
          paths?: string | Array<string>;
          layer?: Schema.Schema.Type<typeof LayerSchema>;
          force?: boolean;
          full?: boolean;
          max_lines?: number;
          around_line?: number;
          context?: number;
          ranges?: ReadonlyArray<unknown>;
          target?: string | Array<string>;
          budget?: number;
        };
        const path = p.path ?? p.paths;
        if (path === undefined) {
          return Effect.fail(
            new ReadbroUnknownError({
              cause: new Error("read_file: path (or paths) is required"),
            }),
          );
        }
        return coalescedReadFile(rb, path, {
          layer: p.layer,
          force: p.force,
          full: p.full,
          maxLines: p.max_lines,
          offset: p.offset,
          around_line: p.around_line,
          context: p.context,
          ranges: p.ranges as ReadbroReadOptions["ranges"],
          target: p.target,
          budget: p.budget,
        });
      },
    );

    yield* registerTool(
      "search_symbol",
      [
        "DEFAULT for precise code lookup when you know a symbol/class/function/use-case name.",
        "Use INSTEAD of grep/rg/SemanticSearch for named symbols — e.g. target: 'IrLayer', 'rootInjectorCb'.",
        "Shorthand: read_file({ path, target }) when you also know the file. Repo-wide: search_symbol({ target }) or path: '.'.",
        "target: string OR array of symbol names — each gets full budget; multi-target runs in parallel.",
        "grep only for regex/text substrings or filename patterns — not named symbols.",
      ].join(" "),
      SearchSymbolSchema,
      (payload) => {
        const p = payload as {
          path?: string;
          budget?: number;
          target?: string | Array<string>;
        };
        return rb.searchSymbol(p);
      },
    );

    yield* registerTool(
      "blast_radius",
      "Git-history risk before editing a file.",
      Schema.Struct({
        file: Schema.String,
        intent: Schema.optional(IntentSchema),
      }),
      (payload) => {
        const p = payload as {
          file: string;
          intent?: Schema.Schema.Type<typeof IntentSchema>;
        };
        return rb.blastRadius(p.file, p.intent);
      },
    );

    yield* registerTool(
      "session_status",
      "Repo health snapshot — totals, efficiency, files tracked. Optional: scope, since, glob, discover_globs, json, verbose.",
      StatsFilterSchema,
      (payload) => {
        const p = payload as {
          scope?: "repo" | "session";
          since?: string;
          glob?: string;
          discover_globs?: number;
          json?: boolean;
          verbose?: boolean;
        };
        return rb.stats(statsRequestFromMcp(p));
      },
    );

    yield* registerTool(
      "session_gain",
      "Where savings come from — top files + optional path/glob drill-down. Same filters as session_status.",
      StatsFilterSchema,
      (payload) => {
        const p = payload as {
          scope?: "repo" | "session";
          since?: string;
          glob?: string;
          discover_globs?: number;
          json?: boolean;
          verbose?: boolean;
        };
        const request = statsRequestFromMcp(p);
        return rb.gain({ ...request, query: { ...request.query, scope: request.query?.scope ?? "session" } });
      },
    );

    yield* registerTool(
      "session_clear",
      "Clear readbro repo cache.",
      Schema.Struct({
        path: Schema.optional(Schema.String),
      }),
      (payload) => {
        const p = payload as { path?: string };
        return rb.clear({ path: p.path });
      },
    );
  }),
).pipe(
  Layer.provide(ReadbroLiveMcp),
  Layer.provide(
    McpServer.layerStdio({
      name: "readbro",
      version: "0.4.0",
      stdin: NodeStream.stdin,
      stdout: NodeSink.stdout,
    }),
  ),
  Layer.provide(Logger.add(Logger.prettyLogger({ stderr: true }))),
);
