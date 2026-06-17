import { McpSchema, McpServer } from "@effect/ai";
import { NodeSink, NodeStream } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as JSONSchema from "effect/JSONSchema";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import type { ReadbroError } from "./errors.ts";
import { Readbro, ReadbroLive } from "./readbro.ts";

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

const registerTool = (
  name: string,
  description: string,
  parameters: Schema.Schema.Any,
  run: (payload: unknown) => Effect.Effect<string, ReadbroError>,
) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const tool = new McpSchema.Tool({
      name,
      description,
      inputSchema: JSONSchema.make(parameters) as McpSchema.Tool["inputSchema"],
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
      `Read a file with composto IR + repo cache. ALWAYS use instead of built-in Read.`,
      Schema.Struct({
        path: Schema.String,
        layer: Schema.optional(LayerSchema),
        force: Schema.optional(Schema.Boolean),
      }),
      (payload) => {
        const p = payload as {
          path: string;
          layer?: Schema.Schema.Type<typeof LayerSchema>;
          force?: boolean;
        };
        return rb.readFile(p.path, { layer: p.layer, force: p.force });
      },
    );

    yield* registerTool(
      "read_files",
      "Batch read with IR caching.",
      Schema.Struct({
        paths: Schema.Array(Schema.String),
        layer: Schema.optional(LayerSchema),
      }),
      (payload) => {
        const p = payload as {
          paths: Array<string>;
          layer?: Schema.Schema.Type<typeof LayerSchema>;
        };
        return rb.readFiles(p.paths, { layer: p.layer });
      },
    );

    yield* registerTool(
      "pack_context",
      "Multi-file bug/trace context within token budget.",
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
      "readbro repo cache stats.",
      Schema.Struct({}),
      () => rb.stats(),
    );

    yield* registerTool(
      "session_clear",
      "Clear readbro repo cache.",
      Schema.Struct({
        path: Schema.optional(Schema.String),
      }),
      (payload) => {
        const p = payload as { path?: string };
        return rb.clear(p.path);
      },
    );
  }),
).pipe(
  Layer.provide(ReadbroLive),
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
