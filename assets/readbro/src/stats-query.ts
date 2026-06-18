export type StatsScope = "repo" | "session";

export type StatsQuery = {
  readonly anchorPath?: string;
  readonly scope?: StatsScope;
  readonly sinceMs?: number;
  readonly glob?: string;
  readonly groupGlobs?: ReadonlyArray<string>;
  readonly byDir?: number;
  readonly discoverGlobs?: number;
};

export type StatsFormat = {
  readonly json?: boolean;
  readonly verbose?: boolean;
};

export type StatsRequest = {
  readonly query?: StatsQuery;
  readonly format?: StatsFormat;
};

export const usesPathGrouping = (query: StatsQuery): boolean =>
  query.glob !== undefined ||
  (query.groupGlobs !== undefined && query.groupGlobs.length > 0) ||
  query.byDir !== undefined ||
  query.discoverGlobs !== undefined;

const DURATION_PATTERN = /^(\d+)([dhmM])$/;

export const parseDuration = (value: string, flag = "--since"): number => {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`invalid ${flag} value "${value}" (use e.g. 7d, 24h, 30m, 3M)`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    M: 30 * 86_400_000,
  } as const;
  return amount * multipliers[unit as keyof typeof multipliers];
};

export const parseSince = (value: string): number => parseDuration(value, "--since");

export const formatSinceLabel = (sinceMs: number): string => {
  if (sinceMs % (30 * 86_400_000) === 0) {
    return `${sinceMs / (30 * 86_400_000)}M`;
  }
  if (sinceMs % 86_400_000 === 0) {
    return `${sinceMs / 86_400_000}d`;
  }
  if (sinceMs % 3_600_000 === 0) {
    return `${sinceMs / 3_600_000}h`;
  }
  if (sinceMs % 60_000 === 0) {
    return `${sinceMs / 60_000}m`;
  }
  return `${Math.round(sinceMs / 1000)}s`;
};

export const statsRequestFromMcp = (payload: {
  readonly scope?: StatsScope;
  readonly since?: string;
  readonly glob?: string;
  readonly discover_globs?: number;
  readonly json?: boolean;
  readonly verbose?: boolean;
}): StatsRequest => {
  const query: StatsQuery = { scope: payload.scope ?? "session" };
  let next = query;

  if (payload.since) {
    next = { ...next, sinceMs: parseSince(payload.since) };
  }
  if (payload.glob) {
    next = { ...next, glob: payload.glob };
  }
  if (payload.discover_globs !== undefined) {
    next = { ...next, discoverGlobs: payload.discover_globs };
  }

  return {
    query: next,
    format: {
      json: payload.json,
      verbose: payload.verbose,
    },
  };
};
