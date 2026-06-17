export type StatsScope = "repo" | "session";

export type StatsQuery = {
  readonly anchorPath?: string;
  readonly scope?: StatsScope;
  readonly sinceMs?: number;
};

const SINCE_PATTERN = /^(\d+)([dhm])$/;

export const parseSince = (value: string): number => {
  const match = SINCE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`invalid --since value "${value}" (use e.g. 7d, 24h, 30m)`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;
  return amount * multipliers[unit as keyof typeof multipliers];
};

export const formatSinceLabel = (sinceMs: number): string => {
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
