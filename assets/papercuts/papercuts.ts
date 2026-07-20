#!/usr/bin/env -S node --experimental-strip-types

let PAPERCUTS_FILE = process.env.PAPERCUTS_FILE || ".papercuts.jsonl";
const AGENT = process.env.PAPERCUTS_AGENT || process.env.OPENCODE_AGENT || process.env.CLAUDE_CODE_AGENT || "unknown";
const NOW = process.env.PAPERCUTS_NOW ? new Date(process.env.PAPERCUTS_NOW) : new Date();

function iso(): string {
  return NOW.toISOString();
}

function shortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "pc_";
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function readRecords(): any[] {
  try {
    const content = require("fs").readFileSync(PAPERCUTS_FILE, "utf-8");
    return content.trim().split("\n").filter(Boolean).map((l: string) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function appendRecord(record: any): void {
  const fs = require("fs");
  const dir = require("path").dirname(PAPERCUTS_FILE);
  if (dir !== ".") fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(PAPERCUTS_FILE, JSON.stringify(record) + "\n", "utf-8");
}

function terminalCutIds(records: any[]): Set<string> {
  return new Set(
    records
      .filter((record: any) => record.kind === "resolve" || record.kind === "unresolvable")
      .map((record: any) => record.cut_id)
  );
}

function resolveId(prefix: string): string | null {
  const records = readRecords();
  const terminal = terminalCutIds(records);
  const open = records.filter(
    (r: any) => r.kind === "cut" && !terminal.has(r.id)
  );
  const match = open.filter((r: any) => r.id.startsWith(prefix));
  if (match.length === 0) return null;
  if (match.length > 1) return null;
  return match[0].id;
}

function cmdAdd(text: string, tags: string[], severity: string): void {
  const record = {
    kind: "cut",
    id: shortId(),
    ts: iso(),
    agent: AGENT,
    text,
    tags,
    severity,
  };
  appendRecord(record);
  const out = { ok: true, data: { changed: true, record } };
  process.stdout.write(JSON.stringify(out) + "\n");
}

function cmdList(format: string, openOnly: boolean): void {
  const records = readRecords();
  const resolved = new Set(
    records.filter((r: any) => r.kind === "resolve").map((r: any) => r.cut_id)
  );
  const unresolvable = new Map(
    records
      .filter((r: any) => r.kind === "unresolvable")
      .map((r: any) => [r.cut_id, r.reason])
  );
  let cuts = records.filter((r: any) => r.kind === "cut");
  if (openOnly) cuts = cuts.filter((r: any) => !resolved.has(r.id) && !unresolvable.has(r.id));
  cuts.sort((a: any, b: any) => {
    const order = { blocker: 0, major: 1, minor: 2 };
    const sa = order[a.severity as keyof typeof order] ?? 2;
    const sb = order[b.severity as keyof typeof order] ?? 2;
    if (sa !== sb) return sa - sb;
    return b.ts.localeCompare(a.ts);
  });
  if (format === "md") {
    for (const c of cuts) {
      const tags = c.tags?.length ? ` [${c.tags.join(", ")}]` : "";
      const reason = unresolvable.get(c.id);
      const status = resolved.has(c.id) ? "[x]" : reason ? "[!]" : "[ ]";
      const outcome = reason ? " **unresolvable**" : "";
      const detail = reason ? `\n  Reason: ${reason}` : "";
      process.stdout.write(`${status} \`${c.id}\` **${c.severity}**${outcome}${tags} — ${c.ts}\n  ${c.text}${detail}\n\n`);
    }
  } else {
    const out = { ok: true, data: { cuts, total: cuts.length } };
    process.stdout.write(JSON.stringify(out) + "\n");
  }
}

function cmdResolve(prefix: string): void {
  const id = resolveId(prefix);
  if (!id) {
    const err = { ok: false, error: { code: "not_found", message: `No open papercut matches prefix "${prefix}"` } };
    process.stderr.write(JSON.stringify(err) + "\n");
    process.exit(66);
  }
  appendRecord({ kind: "resolve", id: shortId(), ts: iso(), cut_id: id });
  const out = { ok: true, data: { cut_id: id } };
  process.stdout.write(JSON.stringify(out) + "\n");
}

function cmdUnresolvable(prefix: string, reason: string): void {
  const id = resolveId(prefix);
  if (!id) {
    const err = { ok: false, error: { code: "not_found", message: `No open papercut matches prefix "${prefix}"` } };
    process.stderr.write(JSON.stringify(err) + "\n");
    process.exit(66);
  }
  appendRecord({ kind: "unresolvable", id: shortId(), ts: iso(), cut_id: id, reason });
  const out = { ok: true, data: { cut_id: id, reason } };
  process.stdout.write(JSON.stringify(out) + "\n");
}

function cmdClean(): void {
  const records = readRecords();
  const resolved = new Set(
    records.filter((r: any) => r.kind === "resolve").map((r: any) => r.cut_id)
  );
  const keep = records.filter(
    (r: any) => !(r.kind === "cut" && resolved.has(r.id)) && !(r.kind === "resolve" && resolved.has(r.cut_id))
  );
  const removed = records.length - keep.length;
  const fs = require("fs");
  fs.writeFileSync(PAPERCUTS_FILE, keep.map((r: any) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  const out = { ok: true, data: { removed, remaining: keep.length } };
  process.stdout.write(JSON.stringify(out) + "\n");
}

function cmdSchema(): void {
  const schema = {
    contract: 2,
    commands: {
      add: { args: ["text"], options: ["--global", "--tag", "--severity"], appends: true },
      list: { options: ["--global", "--format", "--all"], appends: false },
      resolve: { args: ["id"], options: ["--global"], appends: true },
      unresolvable: { args: ["id", "reason"], options: ["--global"], appends: true },
      clean: { options: ["--global"], appends: true },
      schema: { appends: false },
    },
    env: { PAPERCUTS_FILE: { default: ".papercuts.jsonl" }, PAPERCUTS_AGENT: {}, PAPERCUTS_NOW: {} },
    record_shapes: {
      cut: { kind: "cut", id: "string", ts: "ISO8601", agent: "string", text: "string", tags: "string[]", severity: "minor|major|blocker" },
      resolve: { kind: "resolve", id: "string", ts: "ISO8601", cut_id: "string" },
      unresolvable: { kind: "unresolvable", id: "string", ts: "ISO8601", cut_id: "string", reason: "string" },
    },
    exit_codes: { ok: 0, usage: 2, bad_input: 65, not_found: 66, internal: 70 },
  };
  process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
}

const rawArgs = process.argv.slice(2);
const isGlobal = rawArgs.includes("--global");
const isHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const args = rawArgs.filter((a: string) => a !== "--global" && a !== "--help" && a !== "-h");
const cmd = args[0] || "help";

if (isGlobal && !process.env.PAPERCUTS_FILE) {
  PAPERCUTS_FILE = require("path").join(require("os").homedir(), ".papercuts.jsonl");
}

if (isHelp && cmd !== "help" && cmd !== "schema") {
  const helps: Record<string, string> = {
    add: "Usage: papercuts add [--global] <text> [--tag <tag>] [--severity minor|major|blocker]",
    list: "Usage: papercuts list [--global] [--format json|md] [--all]",
    resolve: "Usage: papercuts resolve [--global] <id>",
    unresolvable: "Usage: papercuts unresolvable [--global] <id> <reason>",
    clean: "Usage: papercuts clean [--global]",
  };
  const usage = helps[cmd];
  if (usage) {
    process.stdout.write(usage + "\n");
    process.exit(0);
  }
}

switch (cmd) {
  case "add":
  case "log": {
    const textIdx = args.findIndex((a: string) => !a.startsWith("-"));
    const text = textIdx > 0 ? args[textIdx] : args[1];
    if (!text || text.startsWith("-")) {
      const err = { ok: false, error: { code: "bad_input", message: "Usage: papercuts add <text> [--tag <tag>] [--severity minor|major|blocker]" } };
      process.stderr.write(JSON.stringify(err) + "\n");
      process.exit(65);
    }
    const tags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--tag" && args[i + 1]) {
        tags.push(args[i + 1]);
        i++;
      }
    }
    const sevIdx = args.indexOf("--severity");
    const severity = sevIdx >= 0 && args[sevIdx + 1] ? args[sevIdx + 1] : "minor";
    cmdAdd(text, tags, severity);
    break;
  }
  case "list": {
    const formatIdx = args.indexOf("--format");
    const format = formatIdx >= 0 && args[formatIdx + 1] ? args[formatIdx + 1] : "json";
    const openOnly = !args.includes("--all");
    cmdList(format, openOnly);
    break;
  }
  case "resolve": {
    const id = args[1];
    if (!id) {
      const err = { ok: false, error: { code: "bad_input", message: "Usage: papercuts resolve <id>" } };
      process.stderr.write(JSON.stringify(err) + "\n");
      process.exit(65);
    }
    cmdResolve(id);
    break;
  }
  case "unresolvable": {
    const id = args[1];
    const reason = args.slice(2).join(" ");
    if (!id || !reason) {
      const err = { ok: false, error: { code: "bad_input", message: "Usage: papercuts unresolvable <id> <reason>" } };
      process.stderr.write(JSON.stringify(err) + "\n");
      process.exit(65);
    }
    cmdUnresolvable(id, reason);
    break;
  }
  case "clean": {
    cmdClean();
    break;
  }
  case "schema": {
    cmdSchema();
    break;
  }
  default: {
    process.stdout.write(`papercuts — agent complaint box

Usage:
  papercuts add [--global] <text> [--tag <tag>] [--severity minor|major|blocker]
  papercuts list [--global] [--format json|md] [--all]
  papercuts resolve [--global] <id>
  papercuts unresolvable [--global] <id> <reason>
  papercuts clean [--global]
  papercuts schema
  papercuts help

Flags:
  --global        use ~/.papercuts.jsonl instead of .papercuts.jsonl

Env:
  PAPERCUTS_FILE   — path to JSONL file (default: .papercuts.jsonl, or ~/.papercuts.jsonl with --global)
  PAPERCUTS_AGENT  — agent name (auto-detected)
  PAPERCUTS_NOW    — ISO timestamp override (for reproducible runs)
`);
    process.exit(cmd === "help" ? 0 : 2);
  }
}
