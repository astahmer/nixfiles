export type HistoryFormat = {
  readonly json?: boolean;
};

export type UsageQuery = {
  readonly anchorPath?: string;
  readonly limit?: number;
  readonly skip?: number;
  readonly sinceMs?: number;
  readonly sessionId?: string;
  readonly grep?: string;
  readonly source?: "cli" | "mcp";
};

export type SessionsQuery = {
  readonly anchorPath?: string;
  readonly limit?: number;
  readonly skip?: number;
  readonly sinceMs?: number;
  readonly grep?: string;
};

export type ClearOptions = {
  readonly path?: string;
  readonly olderThanMs?: number;
};
