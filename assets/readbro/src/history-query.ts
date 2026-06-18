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
  /** Default `mcp` — CLI one-shot sessions stay in cache but are hidden here. Use `all` to include them. */
  readonly source?: "cli" | "mcp" | "all";
};

export type ClearOptions = {
  readonly path?: string;
  readonly olderThanMs?: number;
};
