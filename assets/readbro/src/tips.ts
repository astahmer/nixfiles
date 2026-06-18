export type ReadbroTip = {
  readonly id: string;
  readonly text: string;
};

/** Workflow hints — one random unseen tip appended to each MCP tool response. */
export const READBRO_TIPS: ReadonlyArray<ReadbroTip> = [
  {
    id: "plan-pass",
    text: "Multi-file task? Plan paths first, then one L1 batch — serial read_file costs a round-trip each even when cached.",
  },
  {
    id: "batch-paths",
    text: "Known file paths? Batch in one call: read_file({ paths: [\"a.ts\", \"b.ts\"], layer: \"L1\" }) — parallel read_file calls ≠ batch.",
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
    text: "Unchanged re-read saves payload tokens but still costs a round-trip — plan and batch paths upfront.",
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
    id: "l3-full",
    text: "Need a few exact lines? read_file({ path: \"spec.ts\", around_line: 42, layer: \"L3\" }) or ranges — not full-file pagination.",
  },
  {
    id: "multi-symbol",
    text: "Several symbol names? search_symbol({ target: [\"A\", \"B\"] }) — parallel lookup, full budget each.",
  },
  {
    id: "directories",
    text: "read_file rejects directories. Scope a tree with search_symbol, or pass explicit file paths.",
  },
  {
    id: "debug-test-failure",
    text: "Test failure? search_symbol({ target: \"FailingClass\" }) + read_file({ paths: [\"spec.ts\", \"impl.ts\"], layer: \"L1\" }).",
  },
  {
    id: "around-line",
    text: "Stack trace line? read_file({ path: \"spec.ts\", around_line: 223, layer: \"L3\" }) — not offset pagination.",
  },
  {
    id: "session-audit",
    text: "Batching mistakes? Run readbro audit in the repo to see repeat paths and coalesce candidates.",
  },
] as const;

export type ToolCallRecord = {
  readonly tool: string;
  readonly at: number;
  readonly singlePathReads: number;
  readonly path?: string;
};

export type McpTipCoachOptions = {
  readonly tips?: ReadonlyArray<ReadbroTip>;
  readonly rapidWindowMs?: number;
  readonly batchWarnCooldownMs?: number;
  readonly repeatWarnCooldownMs?: number;
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

const readFilePathCount = (payload: unknown): {
  readonly count: number;
  readonly hasTarget: boolean;
  readonly paths: ReadonlyArray<string>;
} => {
  if (payload === null || typeof payload !== "object") {
    return { count: 1, hasTarget: false, paths: [] };
  }
  const p = payload as { path?: string | ReadonlyArray<string>; target?: unknown };
  const hasTarget = p.target !== undefined && p.target !== null && p.target !== "";
  if (typeof p.path === "string") {
    return { count: 1, hasTarget, paths: [p.path] };
  }
  if (Array.isArray(p.path)) {
    return { count: Math.max(1, p.path.length), hasTarget, paths: p.path };
  }
  return { count: 1, hasTarget, paths: [] };
};

export class McpTipCoach {
  readonly #tips: ReadonlyArray<ReadbroTip>;
  readonly #rapidWindowMs: number;
  readonly #batchWarnCooldownMs: number;
  readonly #repeatWarnCooldownMs: number;
  readonly #random: () => number;

  #queue: Array<ReadbroTip> = [];
  #cycle = 0;
  #recentCalls: Array<ToolCallRecord> = [];
  #lastBatchWarnAt = 0;
  #lastRepeatWarnAt = 0;
  #pathReads = new Map<string, { count: number; layers: Set<string> }>();
  #readFileCalls = 0;
  #batchCalls = 0;
  #uniquePaths = new Set<string>();
  #recentBatchCandidates: Array<string> = [];
  #lastFooterAt = 0;

  constructor(options: McpTipCoachOptions = {}) {
    this.#tips = options.tips ?? READBRO_TIPS;
    this.#rapidWindowMs = options.rapidWindowMs ?? 5_000;
    this.#batchWarnCooldownMs = options.batchWarnCooldownMs ?? 15_000;
    this.#repeatWarnCooldownMs = options.repeatWarnCooldownMs ?? 15_000;
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
    let path: string | undefined;

    if (tool === "read_file") {
      const { count, hasTarget, paths } = readFilePathCount(payload);
      this.#readFileCalls += 1;
      if (count > 1) {
        this.#batchCalls += 1;
      }
      for (const item of paths) {
        this.#uniquePaths.add(item);
      }
      if (!hasTarget && count === 1 && paths[0]) {
        path = paths[0];
        const layer =
          typeof payload === "object" && payload !== null && "layer" in payload
            ? String((payload as { layer?: string }).layer ?? "L1")
            : "L1";
        const entry = this.#pathReads.get(path) ?? { count: 0, layers: new Set<string>() };
        entry.layers.add(layer);
        this.#pathReads.set(path, { count: entry.count + 1, layers: entry.layers });

        if (!this.#recentBatchCandidates.includes(path)) {
          this.#recentBatchCandidates.push(path);
        }
        if (this.#recentBatchCandidates.length > 6) {
          this.#recentBatchCandidates = this.#recentBatchCandidates.slice(-6);
        }
      }
    }

    let singlePathReads = 0;
    if (tool === "read_file") {
      const { count, hasTarget, paths } = readFilePathCount(payload);
      if (!hasTarget && count === 1 && paths[0]) {
        singlePathReads = 1;
        path = paths[0];
      }
    }

    const now = Date.now();
    this.#recentCalls.push({ tool, at: now, singlePathReads, path });
    if (this.#recentCalls.length > 16) {
      this.#recentCalls = this.#recentCalls.slice(-16);
    }

    if (tool === "search_symbol") {
      this.#recentCalls = this.#recentCalls.filter((call) => call.tool !== "read_file");
      this.#lastBatchWarnAt = 0;
    } else if (tool === "read_file" && readFilePathCount(payload).count > 1) {
      this.#lastBatchWarnAt = 0;
      this.#lastRepeatWarnAt = 0;
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
      "[readbro hint] Serial read_file calls detected — parallel tool calls ≠ batch. " +
      'One call: read_file({ paths: ["a.ts", "b.ts"], layer: "L1" }). Saves round-trips + tokens.'
    );
  }

  repeatPathHint(tool: string, payload: unknown): string | null {
    if (tool !== "read_file") {
      return null;
    }

    const { count, hasTarget, paths } = readFilePathCount(payload);
    if (hasTarget || count !== 1 || !paths[0]) {
      return null;
    }

    const path = paths[0];
    const entry = this.#pathReads.get(path);
    if (!entry || entry.count < 2) {
      return null;
    }

    const now = Date.now();
    if (this.#lastRepeatWarnAt > 0 && now - this.#lastRepeatWarnAt < this.#repeatWarnCooldownMs) {
      return null;
    }

    this.#lastRepeatWarnAt = now;
    const layers = [...entry.layers].join(", ");
    const strength =
      entry.count >= 3
        ? "Stop re-reading this file — batch other paths or drill with target / around_line / ranges."
        : "You already read this path — batch other files; use around_line or ranges for exact lines.";

    return (
      `[readbro hint] read #${entry.count} of ${path} this session (layers: ${layers}). ${strength}`
    );
  }

  batchSuggestLine(): string | null {
    if (this.#recentBatchCandidates.length < 2) {
      return null;
    }
    const paths = this.#recentBatchCandidates.slice(-4).map((item) => JSON.stringify(item));
    return `suggest: read_file({ paths: [${paths.join(", ")}], layer: "L1" })`;
  }

  sessionFooter(tool: string, payload: unknown): string | null {
    if (tool !== "read_file") {
      return null;
    }

    const extraRoundTrips = Math.max(0, this.#readFileCalls - this.#batchCalls - this.#uniquePaths.size);
    const repeatActive =
      readFilePathCount(payload).paths[0] !== undefined &&
      this.pathReadCount(readFilePathCount(payload).paths[0]!) >= 2;
    const shouldShow =
      repeatActive ||
      extraRoundTrips >= 1 ||
      (this.#readFileCalls >= 2 && this.#batchCalls === 0 && this.#uniquePaths.size >= 2);

    if (!shouldShow) {
      return null;
    }

    const now = Date.now();
    if (this.#lastFooterAt > 0 && now - this.#lastFooterAt < 5_000) {
      return null;
    }
    this.#lastFooterAt = now;

    const lines = [
      `[readbro session] ${this.#readFileCalls} read_file · ${this.#uniquePaths.size} unique paths · ` +
        `${this.#batchCalls} batches · est. +${extraRoundTrips} round-trips`,
      "parallel read_file calls ≠ batch — use paths: [...] in ONE call",
    ];
    const suggest = this.batchSuggestLine();
    if (suggest) {
      lines.push(suggest);
    }
    return lines.join("\n");
  }

  footerFor(tool: string, payload: unknown): string | null {
    const parts: Array<string> = [];
    const hint = this.batchWarning(tool, payload) ?? this.repeatPathHint(tool, payload);
    if (hint) {
      parts.push(hint);
    }

    const session = this.sessionFooter(tool, payload);
    if (session) {
      parts.push(session);
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

  /** Test hook — path read count in this MCP session. */
  pathReadCount(path: string): number {
    return this.#pathReads.get(path)?.count ?? 0;
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
