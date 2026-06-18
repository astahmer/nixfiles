import { McpSchema, McpServer } from "@effect/ai";
import { NodeSink, NodeStream } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as JSONSchema from "effect/JSONSchema";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import type { ReadbroError } from "./errors.ts";
import { Readbro, ReadbroLiveMcp } from "./readbro.ts";
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

const ReadFileSchema = Schema.Struct({
  path: Schema.String,
  layer: Schema.optional(LayerSchema),
  force: Schema.optional(Schema.Boolean),
  max_lines: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  target: Schema.optional(Schema.String),
  budget: Schema.optional(Schema.Number),
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
          Effect.map((text) => textResult(text)),
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
        "Read one file via composto IR + repo cache. ALWAYS use instead of built-in Read.",
        "DEFAULT layer L1 (behaviour IR). Do NOT use L3 for exploration — L3 returns full raw source.",
        "Layers: L0=structure, L1=behaviour (default), L2=delta, L3=raw (avoid; auto-capped).",
        "Re-read unchanged file at same layer in this session → short cache notice.",
        "L3/raw auto-truncates to READBRO_L3_MAX_LINES (default 200); pass max_lines: -1 for full raw.",
        "Optional target: symbol search via composto context (repo root scan; use with class/function name).",
      ].join(" "),
      ReadFileSchema,
      (payload) => {
        const p = payload as {
          path: string;
          layer?: Schema.Schema.Type<typeof LayerSchema>;
          force?: boolean;
          max_lines?: number;
          offset?: number;
          target?: string;
          budget?: number;
        };
        return rb.readFile(p.path, {
          layer: p.layer,
          force: p.force,
          maxLines: p.max_lines,
          offset: p.offset,
          target: p.target,
          budget: p.budget,
        });
      },
    );

    yield* registerTool(
      "read_files",
      "Batch read with IR caching. Same layer/max_lines/offset for all paths. Prefer L1 unless you need raw.",
      Schema.Struct({
        paths: Schema.Array(Schema.String),
        layer: Schema.optional(LayerSchema),
        max_lines: Schema.optional(Schema.Number),
        offset: Schema.optional(Schema.Number),
      }),
      (payload) => {
        const p = payload as {
          paths: Array<string>;
          layer?: Schema.Schema.Type<typeof LayerSchema>;
          max_lines?: number;
          offset?: number;
        };
        return rb.readFiles(p.paths, {
          layer: p.layer,
          maxLines: p.max_lines,
          offset: p.offset,
        });
      },
    );

    yield* registerTool(
      "pack_context",
      "Symbol-aware context pack within token budget. path: directory (default .) or file + target (symbol name). composto scans from repo root — not a single file path alone.",
      Schema.Struct({
        path: Schema.optional(Schema.String),
        budget: Schema.optional(Schema.Number),
        target: Schema.optional(Schema.String),
      }),
      (payload) => {
        const p = payload as { path?: string; budget?: number; target?: string };
        return rb.packContext(p);
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
      version: "0.3.0",
      stdin: NodeStream.stdin,
      stdout: NodeSink.stdout,
    }),
  ),
  Layer.provide(Logger.add(Logger.prettyLogger({ stderr: true }))),
);
