import { Args, Command, Options } from "@effect/cli";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Readbro } from "./readbro.ts";
import { statsRequestFromInput, listQueryFromInput, sessionsQueryFromInput } from "./stats-cli.ts";
import type { StatsRequest } from "./stats-query.ts";
import { parseSince } from "./stats-query.ts";

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

const limit = Options.integer("limit").pipe(
  Options.withDescription("Max entries to show"),
  Options.optional,
);

const skip = Options.integer("skip").pipe(
  Options.withDescription("Skip first N entries (pagination)"),
  Options.optional,
);

const grep = Options.text("grep").pipe(
  Options.withDescription("Filter by text (case-insensitive)"),
  Options.optional,
);

const source = Options.choice("source", ["cli", "mcp"]).pipe(
  Options.withDescription("Filter usage by source"),
  Options.optional,
);

const session = Options.text("session").pipe(
  Options.withDescription("Filter by session id prefix"),
  Options.optional,
);

const olderThan = Options.text("older-than").pipe(
  Options.withDescription("Delete entries older than duration (e.g. 7d, 24h, 3M)"),
  Options.optional,
);

const statsRequestFromCli = (input: {
  scope: "repo" | "session";
  since: Option.Option<string>;
  glob: Option.Option<string>;
  groupGlob: ReadonlyArray<string>;
  byDir: Option.Option<number>;
  discoverGlobs: Option.Option<number>;
  json: boolean;
  verbose: boolean;
}): StatsRequest =>
  statsRequestFromInput({
    scope: input.scope,
    since: Option.getOrUndefined(input.since),
    glob: Option.getOrUndefined(input.glob),
    groupGlob: input.groupGlob,
    byDir: Option.getOrUndefined(input.byDir),
    discoverGlobs: Option.getOrUndefined(input.discoverGlobs),
    json: input.json,
    verbose: input.verbose,
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
        yield* rb.readFile(paths, {
          layer: Option.getOrUndefined(lyr),
          maxLines: Option.getOrUndefined(ml),
          offset: Option.getOrUndefined(off),
        }),
      );
    }),
).pipe(Command.withDescription("Batch read files"));

const symbol = Command.make(
  "symbol",
  {
    path: Options.text("path").pipe(Options.withDefault(".")),
    budget: Options.integer("budget").pipe(Options.withDefault(4000)),
    target: Options.text("target").pipe(Options.optional),
  },
  ({ path, budget, target }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.searchSymbol({ path, budget, target: Option.getOrUndefined(target) }),
      );
    }),
).pipe(Command.withDescription("Search named symbols via composto context"));

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
        yield* rb.searchSymbol({ path, budget, target: Option.getOrUndefined(target) }),
      );
    }),
).pipe(Command.withDescription("Deprecated alias for symbol"));

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
    olderThan,
  },
  ({ path, olderThan: older }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.clear({
          path: Option.getOrUndefined(path),
          olderThanMs: Option.match(older, {
            onNone: () => undefined,
            onSome: (value) => parseSince(value),
          }),
        }),
      );
    }),
).pipe(Command.withDescription("Clear or prune repo cache"));

const ls = Command.make(
  "ls",
  {
    limit,
    skip,
    since,
    session,
    grep,
    source,
    json,
  },
  (input) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.ls(
          listQueryFromInput({
            limit: Option.getOrElse(input.limit, () => 10),
            skip: Option.getOrElse(input.skip, () => 0),
            since: Option.getOrUndefined(input.since),
            session: Option.getOrUndefined(input.session),
            grep: Option.getOrUndefined(input.grep),
            source: Option.getOrUndefined(input.source),
            json: input.json,
          }),
          { json: input.json },
        ),
      );
    }),
).pipe(Command.withDescription("Recent command and tool usage"));

const sessions = Command.make(
  "sessions",
  {
    limit,
    skip,
    since,
    grep,
    json,
  },
  (input) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(
        yield* rb.sessions(
          sessionsQueryFromInput({
            limit: Option.getOrElse(input.limit, () => 20),
            skip: Option.getOrElse(input.skip, () => 0),
            since: Option.getOrUndefined(input.since),
            grep: Option.getOrUndefined(input.grep),
            json: input.json,
          }),
          { json: input.json },
        ),
      );
    }),
).pipe(Command.withDescription("Recent session ids with token savings"));

const doctor = Command.make(
  "doctor",
  {
    path: Options.text("path").pipe(
      Options.withDescription("Anchor working copy (default: cwd)"),
      Options.optional,
    ),
    json,
  },
  ({ path, json: emitJson }) =>
    Effect.gen(function* () {
      const rb = yield* Readbro;
      yield* Console.log(yield* rb.doctor({ path: Option.getOrUndefined(path), json: emitJson }));
    }),
).pipe(Command.withDescription("Preflight environment checks"));

const mcp = Command.make("mcp", {}, () =>
  Effect.gen(function* () {
    const { McpLayer } = yield* Effect.promise(() => import("./mcp.ts"));
    return yield* Layer.launch(McpLayer);
  }),
).pipe(Command.withDescription("Run MCP server on stdio"));

export const root = Command.make("readbro").pipe(
  Command.withSubcommands([read, reads, symbol, context, blast, stats, gain, clear, ls, sessions, doctor, mcp]),
);

export const run = Command.run(root, {
  name: "readbro",
  version: "0.4.0",
});
