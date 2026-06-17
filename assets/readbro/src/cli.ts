import { Args, Command, Options } from "@effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpLayer } from "./mcp.ts";
import { Readbro } from "./readbro.ts";
import { parseSince } from "./stats-query.ts";
import type { StatsQuery, StatsRequest } from "./stats-query.ts";

const layer = Options.choice("layer", ["L0", "L1", "L2", "L3"]).pipe(
  Options.withDescription("IR layer (default L1)"),
  Options.optional,
);

const force = Options.boolean("force").pipe(
  Options.withDescription("Bypass cache"),
  Options.withDefault(false),
);

const maxLines = Options.integer("max-lines").pipe(
  Options.withDescription("Limit output lines (L3/raw default cap; -1 = unlimited)"),
  Options.optional,
);

const offset = Options.integer("offset").pipe(
  Options.withDescription("Start output at this 0-based line"),
  Options.optional,
);

const scope = Options.choice("scope", ["repo", "session"]).pipe(
  Options.withDescription("Stats scope: repo lifetime or current session"),
  Options.withDefault("repo"),
);

const since = Options.text("since").pipe(
  Options.withDescription("Only include reads since duration (e.g. 7d, 24h, 30m)"),
  Options.optional,
);

const glob = Options.text("glob").pipe(
  Options.withDescription("Only include files matching glob (e.g. assets/readbro/**/*.ts)"),
  Options.optional,
);

const groupGlob = Options.text("group-glob").pipe(
  Options.withDescription("Group and rank stats by glob pattern (repeatable)"),
  Options.repeated,
);

const byDir = Options.integer("by-dir").pipe(
  Options.withDescription("Group stats by path prefix depth (e.g. 2 → assets/readbro/**)"),
  Options.optional,
);

const discoverGlobs = Options.integer("discover-globs").pipe(
  Options.withDescription("Auto-rank top N busiest path prefixes"),
  Options.optional,
);

const json = Options.boolean("json").pipe(
  Options.withDescription("Emit machine-readable JSON"),
  Options.withDefault(false),
);

const verbose = Options.boolean("verbose").pipe(
  Options.withDescription("Show breakdown tables (layer, repr, outcome, glob, recent)"),
  Options.withDefault(false),
);

const statsQueryFromCli = (input: {
  scope: "repo" | "session";
  since: Option.Option<string>;
  glob: Option.Option<string>;
  groupGlob: ReadonlyArray<string>;
  byDir: Option.Option<number>;
  discoverGlobs: Option.Option<number>;
}): StatsQuery => {
  let query: StatsQuery = { scope: input.scope };

  if (Option.isSome(input.since)) {
    query = { ...query, sinceMs: parseSince(input.since.value) };
  }
  if (Option.isSome(input.glob)) {
    query = { ...query, glob: input.glob.value };
  }
  if (input.groupGlob.length > 0) {
    query = { ...query, groupGlobs: input.groupGlob };
  }
  if (Option.isSome(input.byDir)) {
    query = { ...query, byDir: input.byDir.value };
  }
  if (Option.isSome(input.discoverGlobs)) {
    query = { ...query, discoverGlobs: input.discoverGlobs.value };
  }

  return query;
};

const statsRequestFromCli = (input: {
  scope: "repo" | "session";
  since: Option.Option<string>;
  glob: Option.Option<string>;
  groupGlob: ReadonlyArray<string>;
  byDir: Option.Option<number>;
  discoverGlobs: Option.Option<number>;
  json: boolean;
  verbose: boolean;
}): StatsRequest => ({
  query: statsQueryFromCli(input),
  format: {
    json: input.json,
    verbose: input.verbose,
  },
});

const statsOptions = {
  scope,
  since,
  glob,
  groupGlob,
  byDir,
  discoverGlobs,
  json,
  verbose,
};

const read = Command.make(
  "read",
  {
    path: Args.text({ name: "path" }),
    layer,
    force,
    maxLines,
    offset,
  },
  ({ path, layer: lyr, force: f, maxLines: ml, offset: off }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.readFile(path, {
          layer: Option.getOrUndefined(lyr),
          force: f,
          maxLines: Option.getOrUndefined(ml),
          offset: Option.getOrUndefined(off),
        }),
      );
    }),
).pipe(Command.withDescription("Read one file with IR cache"));

const reads = Command.make(
  "reads",
  {
    paths: Args.text({ name: "paths" }).pipe(Args.repeated),
    layer,
    maxLines,
    offset,
  },
  ({ paths, layer: lyr, maxLines: ml, offset: off }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.readFiles(paths, {
          layer: Option.getOrUndefined(lyr),
          maxLines: Option.getOrUndefined(ml),
          offset: Option.getOrUndefined(off),
        }),
      );
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

const stats = Command.make("stats", statsOptions, (input) =>
  Effect.gen(function* () {
    const rb = yield* Readbro;
    yield* Console.log(yield* rb.stats(statsRequestFromCli(input)));
  }),
).pipe(Command.withDescription("Repo cache summary"));

const gain = Command.make("gain", statsOptions, (input) =>
  Effect.gen(function* () {
    const rb = yield* Readbro;
    yield* Console.log(yield* rb.gain(statsRequestFromCli(input)));
  }),
).pipe(Command.withDescription("Token savings with top files"));

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
