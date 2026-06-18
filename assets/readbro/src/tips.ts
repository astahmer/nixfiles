export type ReadbroTip = {
  readonly id: string;
  readonly text: string;
};

/** Workflow hints — one random unseen tip appended to each MCP tool response. */
export const READBRO_TIPS: ReadonlyArray<ReadbroTip> = [
  {
    id: "batch-paths",
    text: "Known file paths? Batch in one call: read_file({ path: [\"a.ts\", \"b.ts\"], layer: \"L1\" }) — never parallel read_file.",
  },
  {
    id: "search-symbol",
    text: "Know a class/function/use-case name? search_symbol({ target: \"Foo\" }) — not grep/rg.",
  },
  {
    id: "lod-survey",
    text: "Unfamiliar file? read_file L0 to survey, then L1 for behaviour — skip L3 unless you need exact lines.",
  },
  {
    id: "md-ir",
    text: "Markdown/AGENTS.md: read_file L1 uses md-ir (headings, links, code stubs) — not full prose.",
  },
  {
    id: "cache-reread",
    text: "Re-reading an unchanged file in the same session returns a short cache notice instead of full IR again.",
  },
  {
    id: "blast-radius",
    text: "Before editing non-trivial source: blast_radius({ file, intent: \"bugfix\" }).",
  },
  {
    id: "grep-vs-symbol",
    text: "grep/find/Glob for regex, filenames, or string literals — search_symbol only for named code symbols.",
  },
  {
    id: "session-gain",
    text: "Curious where tokens went? session_gain() shows top files and savings for this repo/session.",
  },
  {
    id: "read-file-target",
    text: "Symbol in a known file? read_file({ path: \"spec.ts\", target: \"MyUseCase\" }) — shorthand for search_symbol.",
  },
  {
    id: "l3-cap",
    text: "L3/raw is auto-capped (~200 lines). Prefer L1; use max_lines only when you need a line window.",
  },
  {
    id: "multi-symbol",
    text: "Several symbol names? search_symbol({ target: [\"A\", \"B\"] }) — parallel lookup, full budget each.",
  },
  {
    id: "directories",
    text: "read_file rejects directories. Scope a tree with search_symbol, or pass explicit file paths.",
  },
] as const;

export type ToolCallRecord = {
  readonly tool: string;
  readonly at: number;
  readonly singlePathReads: number;
};

export type McpTipCoachOptions = {
  readonly tips?: ReadonlyArray<ReadbroTip>;
  readonly rapidWindowMs?: number;
  readonly batchWarnCooldownMs?: number;
  readonly random?: () => number;
};

const defaultRandom = (): number => Math.random();

const shuffle = <T>(items: ReadonlyArray<T>, random: () => number): Array<T> => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

export const formatTipsList = (tips: ReadonlyArray<ReadbroTip> = READBRO_TIPS): string => {
  const lines = ["readbro tips — workflow hints (one random tip per MCP tool call)", ""];
  for (const [index, tip] of tips.entries()) {
    lines.push(`${index + 1}. ${tip.text}`);
  }
  lines.push("", `${tips.length} tips — cycles reshuffle after all have been shown in a session.`);
  return lines.join("\n");
};

export const formatTipsJson = (tips: ReadonlyArray<ReadbroTip> = READBRO_TIPS): string =>
  JSON.stringify(
    tips.map((tip) => ({ id: tip.id, text: tip.text })),
    null,
    2,
  );

const readFilePathCount = (payload: unknown): { readonly count: number; readonly hasTarget: boolean } => {
  if (payload === null || typeof payload !== "object") {
    return { count: 1, hasTarget: false };
  }
  const p = payload as { path?: string | ReadonlyArray<string>; target?: unknown };
  const hasTarget = p.target !== undefined && p.target !== null && p.target !== "";
  const count = typeof p.path === "string" ? 1 : Array.isArray(p.path) ? p.path.length : 1;
  return { count: Math.max(1, count), hasTarget };
};

export class McpTipCoach {
  readonly #tips: ReadonlyArray<ReadbroTip>;
  readonly #rapidWindowMs: number;
  readonly #batchWarnCooldownMs: number;
  readonly #random: () => number;

  #queue: Array<ReadbroTip> = [];
  #cycle = 0;
  #recentCalls: Array<ToolCallRecord> = [];
  #lastBatchWarnAt = 0;

  constructor(options: McpTipCoachOptions = {}) {
    this.#tips = options.tips ?? READBRO_TIPS;
    this.#rapidWindowMs = options.rapidWindowMs ?? 5_000;
    this.#batchWarnCooldownMs = options.batchWarnCooldownMs ?? 15_000;
    this.#random = options.random ?? defaultRandom;
    this.#refillQueue();
  }

  #refillQueue(): void {
    this.#cycle += 1;
    this.#queue = shuffle(this.#tips, this.#random);
  }

  nextTip(): string | null {
    if (this.#queue.length === 0) {
      this.#refillQueue();
    }
    const tip = this.#queue.shift();
    return tip ? `[readbro tip] ${tip.text}` : null;
  }

  recordToolCall(tool: string, payload: unknown): void {
    const now = Date.now();
    let singlePathReads = 0;
    if (tool === "read_file") {
      const { count, hasTarget } = readFilePathCount(payload);
      if (!hasTarget && count === 1) {
        singlePathReads = 1;
      }
    }

    this.#recentCalls.push({ tool, at: now, singlePathReads });
    if (this.#recentCalls.length > 12) {
      this.#recentCalls = this.#recentCalls.slice(-12);
    }

    if (tool === "search_symbol") {
      this.#recentCalls = this.#recentCalls.filter((call) => call.tool !== "read_file");
      this.#lastBatchWarnAt = 0;
    } else if (tool === "read_file" && readFilePathCount(payload).count > 1) {
      this.#lastBatchWarnAt = 0;
    }
  }

  batchWarning(tool: string, payload: unknown): string | null {
    if (tool !== "read_file") {
      return null;
    }

    const { count, hasTarget } = readFilePathCount(payload);
    if (hasTarget || count > 1) {
      return null;
    }

    const now = Date.now();
    if (this.#lastBatchWarnAt > 0 && now - this.#lastBatchWarnAt < this.#batchWarnCooldownMs) {
      return null;
    }

    const recent = this.#recentCalls.filter((call) => now - call.at <= this.#rapidWindowMs);
    const rapidSingleReads = recent.reduce((sum, call) => sum + call.singlePathReads, 0);

    const lastTwo = this.#recentCalls.slice(-2);
    const consecutiveSingleReads =
      lastTwo.length === 2 &&
      lastTwo.every((call) => call.tool === "read_file" && call.singlePathReads === 1);

    const shouldWarn = rapidSingleReads >= 2 || consecutiveSingleReads;
    if (!shouldWarn) {
      return null;
    }

    this.#lastBatchWarnAt = now;
    return (
      "[readbro hint] Serial read_file calls detected — batch known paths in one call: " +
      'read_file({ path: ["a.ts", "b.ts"], layer: "L1" }). ' +
      "Use search_symbol when you know a symbol name; grep/find for regex or filenames."
    );
  }

  footerFor(tool: string, payload: unknown): string | null {
    const parts: Array<string> = [];
    const hint = this.batchWarning(tool, payload);
    if (hint) {
      parts.push(hint);
    }
    const tip = this.nextTip();
    if (tip) {
      parts.push(tip);
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }

  /** Test hook — tips shown this cycle (approximate). */
  cycle(): number {
    return this.#cycle;
  }
}

let defaultCoach: McpTipCoach | undefined;

export const getMcpTipCoach = (): McpTipCoach => {
  if (!defaultCoach) {
    defaultCoach = new McpTipCoach();
  }
  return defaultCoach;
};

export const resetMcpTipCoach = (coach?: McpTipCoach): void => {
  defaultCoach = coach;
};

export const appendMcpFooter = (tool: string, payload: unknown, text: string): string => {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return text;
  }

  const coach = getMcpTipCoach();
  coach.recordToolCall(tool, payload);
  const footer = coach.footerFor(tool, payload);
  return footer ? `${text}\n\n${footer}` : text;
};
