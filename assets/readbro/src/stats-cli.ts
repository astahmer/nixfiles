import type { ClearOptions } from "./history-query.ts";
import { parseDuration, parseSince, type StatsQuery, type StatsRequest } from "./stats-query.ts";

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

export type ListCliInput = {
  readonly limit: number;
  readonly skip: number;
  readonly since?: string;
  readonly session?: string;
  readonly grep?: string;
  readonly source?: "cli" | "mcp";
  readonly json: boolean;
};

export type SessionsCliInput = {
  readonly limit: number;
  readonly skip: number;
  readonly since?: string;
  readonly grep?: string;
  readonly json: boolean;
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

export type FastCommand = "gain" | "stats" | "clear" | "ls" | "sessions";

export const parseFastCommand = (
  argv: ReadonlyArray<string>,
): { readonly command: FastCommand; readonly rest: ReadonlyArray<string> } | null => {
  const command = argv[2];
  if (
    command === "gain" ||
    command === "stats" ||
    command === "clear" ||
    command === "ls" ||
    command === "sessions"
  ) {
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

const parseLimit = (args: ReadonlyArray<string>, index: number, flag: string): number => {
  const value = Number(nextFlagValue(args, index, flag));
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return value;
};

const parseSkip = (args: ReadonlyArray<string>, index: number): number => {
  const value = Number(nextFlagValue(args, index, "--skip"));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("--skip requires a non-negative integer");
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
      case "-h":
      case "--help":
        break;
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

export const parseClearFlags = (args: ReadonlyArray<string>): ClearOptions => {
  let path: string | undefined;
  let olderThanMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "-h":
      case "--help":
        break;
      case "--path":
        path = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--older-than":
        olderThanMs = parseDuration(nextFlagValue(args, index, arg), "--older-than");
        index += 1;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return { path, olderThanMs };
};

export const parseLsFlags = (args: ReadonlyArray<string>): ListCliInput => {
  let limit = 10;
  let skip = 0;
  let since: string | undefined;
  let session: string | undefined;
  let grep: string | undefined;
  let source: "cli" | "mcp" | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "-h":
      case "--help":
        break;
      case "-n":
      case "--limit":
        limit = parseLimit(args, index, arg);
        index += 1;
        break;
      case "--skip":
        skip = parseSkip(args, index);
        index += 1;
        break;
      case "--since":
        since = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--session":
        session = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--grep":
        grep = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--source": {
        const value = nextFlagValue(args, index, arg);
        if (value !== "cli" && value !== "mcp") {
          throw new Error(`invalid --source value "${value}"`);
        }
        source = value;
        index += 1;
        break;
      }
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return { limit, skip, since, session, grep, source, json };
};

export const parseSessionsFlags = (args: ReadonlyArray<string>): SessionsCliInput => {
  let limit = 20;
  let skip = 0;
  let since: string | undefined;
  let grep: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "-h":
      case "--help":
        break;
      case "-n":
      case "--limit":
        limit = parseLimit(args, index, arg);
        index += 1;
        break;
      case "--skip":
        skip = parseSkip(args, index);
        index += 1;
        break;
      case "--since":
        since = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--grep":
        grep = nextFlagValue(args, index, arg);
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return { limit, skip, since, grep, json };
};

export const listQueryFromInput = (input: ListCliInput) => ({
  limit: input.limit,
  skip: input.skip,
  sinceMs: input.since ? parseSince(input.since) : undefined,
  sessionId: input.session,
  grep: input.grep,
  source: input.source,
});

export const sessionsQueryFromInput = (input: SessionsCliInput) => ({
  limit: input.limit,
  skip: input.skip,
  sinceMs: input.since ? parseSince(input.since) : undefined,
  grep: input.grep,
});
