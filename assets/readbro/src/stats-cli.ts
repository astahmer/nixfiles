import { parseSince, type StatsQuery, type StatsRequest } from "./stats-query.ts";

export type StatsCliInput = {
  readonly scope: "repo" | "session";
  readonly since?: string;
  readonly glob?: string;
  readonly groupGlob: ReadonlyArray<string>;
  readonly byDir?: number;
  readonly discoverGlobs?: number;
  readonly json: boolean;
  readonly verbose: boolean;
};

export const statsQueryFromInput = (input: StatsCliInput): StatsQuery => {
  let query: StatsQuery = { scope: input.scope };

  if (input.since !== undefined) {
    query = { ...query, sinceMs: parseSince(input.since) };
  }
  if (input.glob !== undefined) {
    query = { ...query, glob: input.glob };
  }
  if (input.groupGlob.length > 0) {
    query = { ...query, groupGlobs: input.groupGlob };
  }
  if (input.byDir !== undefined) {
    query = { ...query, byDir: input.byDir };
  }
  if (input.discoverGlobs !== undefined) {
    query = { ...query, discoverGlobs: input.discoverGlobs };
  }

  return query;
};

export const statsRequestFromInput = (input: StatsCliInput): StatsRequest => ({
  query: statsQueryFromInput(input),
  format: {
    json: input.json,
    verbose: input.verbose,
  },
});

export type FastCommand = "gain" | "stats" | "clear";

export const parseFastCommand = (
  argv: ReadonlyArray<string>,
): { readonly command: FastCommand; readonly rest: ReadonlyArray<string> } | null => {
  const command = argv[2];
  if (command === "gain" || command === "stats" || command === "clear") {
    return { command, rest: argv.slice(3) };
  }
  return null;
};

const nextFlagValue = (args: ReadonlyArray<string>, index: number, flag: string): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseStatsFlags = (args: ReadonlyArray<string>): StatsCliInput => {
  let scope: "repo" | "session" = "repo";
  let since: string | undefined;
  let glob: string | undefined;
  const groupGlob: Array<string> = [];
  let byDir: number | undefined;
  let discoverGlobs: number | undefined;
  let json = false;
  let verbose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--scope": {
        const value = nextFlagValue(args, index, arg);
        if (value !== "repo" && value !== "session") {
          throw new Error(`invalid --scope value "${value}"`);
        }
        scope = value;
        index += 1;
        break;
      }
      case "--since":
        since = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--glob":
        glob = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--group-glob":
        groupGlob.push(nextFlagValue(args, index, arg));
        index += 1;
        break;
      case "--by-dir":
        byDir = Number(nextFlagValue(args, index, arg));
        index += 1;
        break;
      case "--discover-globs":
        discoverGlobs = Number(nextFlagValue(args, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return { scope, since, glob, groupGlob, byDir, discoverGlobs, json, verbose };
};

export const parseClearFlags = (args: ReadonlyArray<string>): string | undefined => {
  let path: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--path") {
      path = nextFlagValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return path;
};
