#!/usr/bin/env -S node --experimental-strip-types

const PAPERCUTS_FILE = process.env.PAPERCUTS_FILE || ".papercuts.jsonl";
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

function resolveId(prefix: string): string | null {
  const records = readRecords();
  const resolved = new Set(
    records.filter((r: any) => r.kind === "resolve").map((r: any) => r.cut_id)
  );
  const open = records.filter(
    (r: any) => r.kind === "cut" && !resolved.has(r.id)
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
  let cuts = records.filter((r: any) => r.kind === "cut");
  if (openOnly) cuts = cuts.filter((r: any) => !resolved.has(r.id));
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
      const status = resolved.has(c.id) ? "[x]" : "[ ]";
      process.stdout.write(`${status} \`${c.id}\` **${c.severity}**${tags} — ${c.ts}\n  ${c.text}\n\n`);
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

function cmdSchema(): void {
  const schema = {
    contract: 1,
    commands: {
      add: { args: ["text"], options: ["--tag", "--severity"], appends: true },
      list: { options: ["--format", "--open"], appends: false },
      resolve: { args: ["id"], appends: true },
      schema: { appends: false },
    },
    env: { PAPERCUTS_FILE: { default: ".papercuts.jsonl" }, PAPERCUTS_AGENT: {}, PAPERCUTS_NOW: {} },
    record_shapes: {
      cut: { kind: "cut", id: "string", ts: "ISO8601", agent: "string", text: "string", tags: "string[]", severity: "minor|major|blocker" },
      resolve: { kind: "resolve", id: "string", ts: "ISO8601", cut_id: "string" },
    },
    exit_codes: { ok: 0, usage: 2, bad_input: 65, not_found: 66, internal: 70 },
  };
  process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
}

const args = process.argv.slice(2);
const cmd = args[0] || "help";

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
    const tagIdx = args.indexOf("--tag");
    const tags = tagIdx >= 0 && args[tagIdx + 1] ? [args[tagIdx + 1]] : [];
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
  case "schema": {
    cmdSchema();
    break;
  }
  default: {
    process.stdout.write(`papercuts — agent complaint box

Usage:
  papercuts add <text> [--tag <tag>] [--severity minor|major|blocker]
  papercuts list [--format json|md] [--all]
  papercuts resolve <id>
  papercuts schema
  papercuts help

Env:
  PAPERCUTS_FILE   — path to JSONL file (default: .papercuts.jsonl)
  PAPERCUTS_AGENT  — agent name (auto-detected)
  PAPERCUTS_NOW    — ISO timestamp override (for reproducible runs)
`);
    process.exit(cmd === "help" ? 0 : 2);
  }
}
