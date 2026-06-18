import type { FastCommand } from "./stats-cli.ts";

const statsHelp = `readbro stats — repo cache summary

Usage:
  readbro stats [options]

Options:
  --scope repo|session   Stats scope (default: repo)
  --since <duration>     Only reads since (e.g. 7d, 24h, 30m, 3M)
  --glob <pattern>       Filter files by glob
  --group-glob <pattern> Group by glob (repeatable)
  --by-dir <depth>       Group by path prefix depth
  --discover-globs <n>   Auto-rank top N path prefixes
  --json                 Machine-readable JSON
  --verbose              Layer/repr/outcome/glob breakdown
  -h, --help             Show this help`;

const gainHelp = `readbro gain — token savings with top files

Usage:
  readbro gain [options]

Options:
  --scope repo|session   Stats scope (default: repo)
  --since <duration>     Only reads since (e.g. 7d, 24h, 30m, 3M)
  --glob <pattern>       Filter files by glob
  --group-glob <pattern> Group by glob (repeatable)
  --by-dir <depth>       Group by path prefix depth
  --discover-globs <n>   Auto-rank top N path prefixes
  --json                 Machine-readable JSON
  --verbose              Include glob tables and recent reads
  -h, --help             Show this help`;

const clearHelp = `readbro clear — clear or prune repo cache

Usage:
  readbro clear [options]

Options:
  --path <path>          Limit to one working copy
  --older-than <dur>     Delete entries older than duration (e.g. 7d, 24h, 3M)
  -h, --help             Show this help

Without --older-than, clears all cached IR, session reads, and events.`;

const lsHelp = `readbro ls — recent command and tool usage

Usage:
  readbro ls [options]

Options:
  -n, --limit <n>        Max entries (default: 10)
  --skip <n>             Skip first N entries (pagination)
  --since <duration>     Only usage since (e.g. 7d, 24h, 30m, 3M)
  --session <id>         Filter by session id prefix
  --grep <text>          Filter name/detail (case-insensitive)
  --source cli|mcp       Filter by source
  --json                 Machine-readable JSON
  -h, --help             Show this help`;

const sessionsHelp = `readbro sessions — MCP agent sessions with token savings

Usage:
  readbro sessions [options]

Shows MCP agent sessions by default. CLI one-shot reads still hit the cache but
are hidden here — use readbro ls for command history.

Options:
  -n, --limit <n>        Max sessions (default: 20)
  --skip <n>             Skip first N sessions (pagination)
  --since <duration>     Only sessions active since (e.g. 7d, 24h, 3M)
  --grep <text>          Filter session id (case-insensitive)
  --all                  Include CLI one-shot sessions
  --source cli|mcp|all   Filter by usage source (default: mcp)
  --json                 Machine-readable JSON
  -h, --help             Show this help`;

const doctorHelp = `readbro doctor — preflight environment checks

Usage:
  readbro doctor [options]

Options:
  --path <path>          Anchor working copy (default: cwd)
  --json                 Machine-readable JSON
  -h, --help             Show this help

Checks composto on PATH, L1 IR smoke probe, cache writable, schema version, session id, repo root.`;

const HELP: Record<FastCommand, string> = {
  stats: statsHelp,
  gain: gainHelp,
  clear: clearHelp,
  ls: lsHelp,
  sessions: sessionsHelp,
  doctor: doctorHelp,
};

export const printFastHelp = (command: FastCommand): void => {
  console.log(HELP[command]);
};

export const wantsHelp = (args: ReadonlyArray<string>): boolean =>
  args.some((arg) => arg === "-h" || arg === "--help");
