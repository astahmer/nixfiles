import { Args, Command, Options } from "@effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpLayer } from "./mcp.ts";
import { Readbro } from "./readbro.ts";

const layer = Options.choice("layer", ["L0", "L1", "L2", "L3"]).pipe(
  Options.withDescription("IR layer (default L1)"),
  Options.optional,
);

const force = Options.boolean("force").pipe(
  Options.withDescription("Bypass cache"),
  Options.withDefault(false),
);

const read = Command.make(
  "read",
  {
    path: Args.text({ name: "path" }),
    layer,
    force,
  },
  ({ path, layer: lyr, force: f }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.readFile(path, { layer: Option.getOrUndefined(lyr), force: f }),
      );
    }),
).pipe(Command.withDescription("Read one file with IR cache"));

const reads = Command.make(
  "reads",
  {
    paths: Args.text({ name: "paths" }).pipe(Args.repeated),
    layer,
  },
  ({ paths, layer: lyr }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(yield* rb.readFiles(paths, { layer: Option.getOrUndefined(lyr) }));
    }),
).pipe(Command.withDescription("Batch read files"));

const context = Command.make(
  "context",
  {
    path: Options.text("path").pipe(Options.withDefault(".")),
    budget: Options.integer("budget").pipe(Options.withDefault(4000)),
    target: Options.text("target").pipe(Options.optional),
  },
  ({ path, budget, target }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.packContext({ path, budget, target: Option.getOrUndefined(target) }),
      );
    }),
).pipe(Command.withDescription("Pack multi-file context"));

const blast = Command.make(
  "blast",
  {
    file: Args.text({ name: "file" }),
    intent: Options.choice("intent", [
      "refactor",
      "bugfix",
      "feature",
      "test",
      "docs",
      "unknown",
    ]).pipe(Options.optional),
  },
  ({ file, intent }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(yield* rb.blastRadius(file, Option.getOrUndefined(intent)));
    }),
).pipe(Command.withDescription("Blast radius before editing"));

const stats = Command.make("stats", {}, () =>
  Effect.gen(function* () {
    const rb = yield* Readbro;
    yield* Console.log(yield* rb.stats());
  }),
).pipe(Command.withDescription("Repo cache stats"));

const gain = Command.make("gain", {}, () =>
  Effect.gen(function* () {
    const rb = yield* Readbro;
    yield* Console.log(yield* rb.gain());
  }),
).pipe(Command.withDescription("Token savings summary"));

const clear = Command.make(
  "clear",
  {
    path: Options.text("path").pipe(Options.optional),
  },
  ({ path }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(yield* rb.clear(Option.getOrUndefined(path)));
    }),
).pipe(Command.withDescription("Clear repo cache"));

const mcp = Command.make("mcp", {}, () => Layer.launch(McpLayer)).pipe(
  Command.withDescription("Run MCP server on stdio"),
);

export const root = Command.make("readbro").pipe(
  Command.withSubcommands([read, reads, context, blast, stats, gain, clear, mcp]),
);

export const run = Command.run(root, {
  name: "readbro",
  version: "0.3.0",
});
