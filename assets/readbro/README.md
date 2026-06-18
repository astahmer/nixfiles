# readbro

IR-aware read cache for coding agents — MCP server plus CLI. Compresses source through [composto](https://github.com/composto-ai/composto) IR, caches reads per session, and returns diffs on re-read instead of shipping the full file again.

## Why

Agent file reads are expensive: every `Read` call sends raw source into context. readbro defaults to **L1 behaviour IR** (~10–50× smaller than raw), tracks what each session has already seen, and on repeat reads returns an **unchanged notice** or a **compact IR diff** — session diff semantics inspired by [cachebro](https://github.com/glommer/cachebro). `search_symbol` and `blast_radius` round out exploration and edit safety.

## Requirements

| Dependency | Role |
|------------|------|
| **composto** | IR generation (`composto ir`, `composto context`, `composto blast`). Must be on `PATH`. |
| **Node ≥ 24** | Tests and dev (`node --experimental-strip-types`). |
| **Bun** | Production compile only (`bun build --compile`). Nix build uses pnpm for deps. |

In this flake, Home Manager deploys a store-pinned binary; the shell hook installs `composto-ai` globally when missing.

## Install

**Nix (recommended in nixfiles):**

```bash
nix run nixpkgs#home-manager -- switch -b backup --flake .#macbook
```

Adds `readbro` to `PATH` and wires MCP configs under `assets/.cursor/`, `assets/vscode/`, and `assets/.config/opencode/`.

**Local compile:**

```bash
cd assets/readbro
pnpm install
bun run build    # → ./readbro single executable
```

**MCP config** (any editor):

```json
{
  "mcpServers": {
    "readbro": { "command": "readbro" }
  }
}
```

No args → MCP stdio server. Same binary serves CLI subcommands.

## MCP tools

| Tool | Purpose |
|------|---------|
| `search_symbol` | **Default for precise lookup** — named symbols; use instead of grep. |
| `read_file` | Read file(s); `path` string or array; optional `target` delegates to symbol search. |
| `blast_radius` | Git-history risk before editing a file. |
| `session_status` | Repo health — totals, efficiency, files tracked. |
| `session_gain` | Where savings come from — top files, glob drill-down. |
| `session_clear` | Reset repo cache. |

### `read_file` parameters

| Param | Default | Notes |
|-------|---------|-------|
| `path` | — | String or array of paths (batch in one call). `paths` is an alias. |
| `layer` | `L1` | `L0` structure · `L1` behaviour · `L3` raw. |
| `force` | `false` | Bypass cache; always return full payload. |
| `full` | `false` | Shorthand for full raw read (`layer: L3`, no line cap). |
| `max_lines` | — | Cap output lines. L3 auto-caps at 200 unless `-1` or `full: true`. |
| `offset` | — | 0-based line offset (L3 windows). |
| `target` | — | Symbol name (string) or array — delegates to `search_symbol` (single path only). |
| `budget` | `4000` | Token budget when `target` set. |

**Precise symbol lookup:** use `target` or `search_symbol` — don't grep or read whole file at L1 first. **Exploratory reads** (no symbol): default L1.

### `search_symbol` parameters

| Param | Default | Notes |
|-------|---------|-------|
| `path` | `.` | Directory or file to scope search. |
| `target` | — | Symbol name (string or array). **Prefer for audits.** |
| `budget` | `4000` | Token budget for composto context. |

Shorthand: `read_file({ path, target })` when you know the file. grep only for regex/text and filename patterns.

### Language support (composto)

| Language | IR quality |
|----------|------------|
| TypeScript / TSX, JavaScript / JSX | Deeply tuned |
| Python, Go, Rust | Basic |
| Other extensions | Regex fingerprinter (less accurate) |

Unsupported extensions (Nix, Markdown, YAML, …) return raw at L1 with an advisory.

### IR layers (LOD)

| Layer | Content | When |
|-------|---------|------|
| **L0** | Structure — exports, classes, functions | Survey unfamiliar files |
| **L1** | Behaviour IR | **Default** — how code works |
| **L3** | Raw source | Rare — tiny files or `max_lines` window |

Typical flow: L0 → L1, stop. Drill to L3 only when you need exact text. After edits, re-read at L1 — the session cache returns an IR diff automatically (no separate delta layer).

**Why no L2?** [composto](https://github.com/mertcanaltin/composto) defines L2 as git-delta IR, but `composto ir` never passes `delta` into `generateLayer`, so L2 falls back to L1. readbro does not expose L2 in layer options to avoid that confusion.

### Session cache

Cache lives at **`.readbro/cache.db`** in the working-copy root (`READBRO_DIR` overrides). Billing is **per MCP session** (`READBRO_SESSION_ID` optional).

- **First read** in a session → full IR for that layer.
- **Unchanged re-read** → short notice (`~N tokens saved`).
- **File changed** → unified IR diff vs last session read at the **same layer**.
- **Layer drill** (L0→L1 in same session) → full payload for each layer (cross-layer diff removed — different IR shapes).
- **New session** on warm repo → full IR again (that session hasn't seen the file yet).

`session_status` / `session_gain` / `session_clear` manage and inspect the cache.

### MCP tips and hints

Every MCP tool response (except JSON payloads) ends with lightweight coaching — rules alone don't stick, so readbro nudges in-band while the agent still has the file context fresh.

- **`[readbro tip]`** — one random workflow hint per call (batch reads, `search_symbol`, LOD, md-ir, debug-test-failure, …). Unseen tips first; when all 14 have been shown, the pool reshuffles and continues (long sessions often compact context, so reminders help).
- **`[readbro hint]`** — when serial single-path `read_file` calls are detected (e.g. two within 5s) **or** when the same path is read again in the session. Suggests batching with `paths: [...]` or `around_line` / `ranges` for exact lines. Skipped for path arrays and `target` shorthand.
- **`[readbro session]`** — periodic footer on `read_file`: read count, batches, est. extra round-trips; reminds that parallel calls ≠ batch.
- **`[readbro session]`** — periodic footer with read_file count, unique paths, batches, and estimated extra round-trips.

On **unchanged IR** cache hits (2nd+ read of same file), the notice now includes read number, layers/windows already fetched, and a suggested next action.

List all tips: `readbro tips` (or `readbro tips --json`).

## readbro vs composto

readbro is a thin wrapper around composto for IR generation. It shells out to `composto ir <path> <layer>` (see `src/ir.ts`). The value is not a different compression algorithm — it is **session-scoped caching** on top of composto.

### Two different “delta” ideas

The name **L2** is used in two unrelated ways, which is the main source of confusion.

**composto L2 = git change context.** In [composto’s docs](https://github.com/mertcanaltin/composto) (also under `.references/composto` in this flake), L2 means “what changed in this file?” as git-oriented delta IR: `CHANGED:` hunks with surrounding IR, optional `SCOPE:`, `BLAME:`, and health tags. The intended use case is PR review — changed files at L2, everything else at L1. Implementation lives in `src/ir/delta.ts` (`getFileDelta` runs `git diff HEAD`) and `src/ir/layers.ts` (`generateL2`).

**readbro “delta” = session cache diff.** On re-read, readbro compares the current IR payload to what **this MCP session** last saw at the same layer. Unchanged file → short `unchanged IR` notice. File edited since last read → unified diff of IR lines (`src/differ.ts`). Layer drill (L0→L1) → full payload per layer. That is conversation memory, not git history.

### composto L2 today

`generateL2` exists, but neither `composto ir` nor the `composto_ir` MCP tool passes `delta` into `generateLayer` — both call it with only `code`, `filePath`, and `health`. When `delta` is missing, composto falls back to L1:

```ts
case "L2":
  if (!options.delta) return generateL1(options.code, options.filePath, options.health);
  return generateL2(options.delta, options.health);
```

So `read_file` with `layer: "L2"` is effectively composto L1 in practice. readbro’s post-edit savings come from the session cache at **L1** (or whatever layer you chose), not from composto L2.

### Is readbro worth it over composto alone?

Yes — different layer, complementary roles.

| | composto (L1) | readbro |
|--|---------------|---------|
| First read | ~89% IR compression | Same (calls composto) |
| Re-read same file | Full IR again | Few tokens (`unchanged IR` notice) |
| After you edit | Full IR again | Compact IR diff vs last session read |
| L0→L1 drill | Full payload for each layer | Full payload for each layer |
| Agent integration | CLI / composto MCP | readbro MCP + stats + blast_radius wrapper |

composto compresses once. readbro avoids paying twice in long agent loops. The benchmark under `benchmark/` compares `readbro (L1)` against `composto (L1 only)` — the extra savings are from session caching.

### Latest benchmark (2026-06-18, composto fixtures, 11 scenarios)

| Strategy | Avg savings vs raw |
|----------|-------------------|
| readbro (L0) | 98.5% |
| readbro (L1) | 89.8% |
| composto (L1 only) | 79.7% |
| readbro (per-step layers) | 88.5% |
| composto (per-step layers) | 88.5% |
| cachebro (raw cache) | 64.0% |

**readbro (L1) vs composto (L1 only): +10.1pp avg.** Layer drill (L0→L1 per file) bills identically for readbro and composto — no cross-layer diff inflation.

Run: `pnpm run benchmark` (requires `.references/composto`).

### Practical guidance

- **Default to L1** for understanding code.
- **Do not reach for L2 expecting magic** — re-read at L1; the session cache returns a diff automatically after edits.
- **composto L2** (when wired end-to-end) is for git/PR “what changed vs HEAD” — orthogonal to readbro caching.
- **L3** is raw source. Use only for small files or explicit `max_lines` windows.

Upstream reference clone: `.references/composto` ([mertcanaltin/composto](https://github.com/mertcanaltin/composto)).

## CLI

Fast path (`gain`, `stats`, `clear`, `ls`, `sessions`, `doctor`, `tips`) skips Effect startup (~30 ms warm). MCP and other commands load the full stack lazily. Fast-path commands support `-h` / `--help` without loading Effect.

| Command | Action |
|---------|--------|
| `readbro` | MCP server (stdio) |
| `readbro mcp` | MCP server explicitly |
| `readbro read <paths…>` | Read one or more files (`--layer`, `--force`, `--target`) |
| `readbro symbol` | Symbol search (`--path`, `--budget`, `--target`) |
| `readbro context` | Deprecated alias for `symbol` |
| `readbro blast <file>` | Blast radius (`--intent`) |
| `readbro stats` | Repo health snapshot |
| `readbro gain` | Token savings with top files |
| `readbro ls` | Recent command/tool usage |
| `readbro sessions` | MCP agent sessions (`--all` to include CLI) |
| `readbro tips` | List workflow hints (also shown one per MCP call) |
| `readbro doctor` | Preflight checks (composto, cache, schema) |
| `readbro audit` | Session read-pattern forensics (repeat paths, batch opportunities) |
| `readbro clear` | Clear or prune cache |

### `stats` / `gain`

Shared filters and output options:

| Flag | Notes |
|------|-------|
| `--scope repo\|session` | Lifetime repo stats vs current session (default: `repo`) |
| `--since <dur>` | Window filter — `7d`, `24h`, `30m`, `3M` (month = 30d) |
| `--glob <pattern>` | Only files matching glob |
| `--group-glob <pattern>` | Group/rank by glob (repeatable) |
| `--by-dir <depth>` | Group by path prefix depth |
| `--discover-globs <n>` | Auto-rank top N busiest prefixes |
| `--json` | Full stats payload as JSON (for CI, dashboards, piping) |
| `--verbose` | Breakdown tables; `gain` also shows recent reads |

```bash
readbro stats --since 7d --verbose
readbro gain --json > /tmp/readbro-gain.json   # export — no separate command needed
readbro stats -h                               # fast-path help
```

### `ls`

Recent CLI invocations and MCP tool calls (from `usage_events`).

| Flag | Default | Notes |
|------|---------|-------|
| `-n`, `--limit` | 10 | Max entries |
| `--skip` | 0 | Pagination offset |
| `--since <dur>` | — | Only usage in window |
| `--session <id>` | — | Session id prefix |
| `--grep <text>` | — | Match name or detail |
| `--source cli\|mcp` | — | Filter by source |
| `--json` | — | Machine-readable list |

```bash
readbro ls -n 25 --grep read_file --source mcp
```

### `sessions`

Sessions ranked by last activity, with read counts and token savings.

| Flag | Default | Notes |
|------|---------|-------|
| `-n`, `--limit` | 20 | Max sessions |
| `--skip` | 0 | Pagination (`--skip 20` ≈ page 2) |
| `--since <dur>` | — | Only sessions active in window |
| `--grep <text>` | — | Filter session id |
| `--json` | — | Machine-readable list |

```bash
readbro sessions --since 7d --grep abc
```

### `clear`

| Flag | Notes |
|------|-------|
| `--path <path>` | Limit to one working copy |
| `--older-than <dur>` | **Prune** entries older than duration; omit for full wipe |

```bash
readbro clear --older-than 30d
readbro clear --path . --older-than 7d
readbro clear                    # full clear (all open repo DBs)
```

Duration suffixes: `m` minutes, `h` hours, `d` days, `M` months (30d each).

### `doctor`

Preflight before agents run — surfaces misconfig that causes raw fallbacks.

| Flag | Notes |
|------|-------|
| `--path <path>` | Anchor working copy (default: cwd) |
| `--json` | Machine-readable report |
| `-h`, `--help` | Fast-path help |

Checks:

- `composto` on PATH (+ version when available)
- `composto ir` L1 smoke probe on a temp file
- `.readbro/` (or `READBRO_DIR`) writable
- cache DB schema version
- session id (`READBRO_SESSION_ID` or auto)
- git/jj repo root

Exit code `1` when any check **fails** (`✗`). Warnings (`!`) do not fail the run.

```bash
readbro doctor
readbro doctor --json
```

### `audit`

Session forensics for agent authors — repeat paths, coalesce candidates, symbol searches.

| Flag | Notes |
|------|-------|
| `--path <path>` | Anchor working copy (default: cwd) |
| `--session <id>` | Session id prefix (default: current session) |
| `--json` | Machine-readable report |

```bash
readbro audit
readbro audit --session 111d2123 --json
```

### MCP coalescing

Parallel `read_file` calls in the same turn (same layer, no `target`/`offset`) are buffered ~50ms and merged into one batch read. Each caller gets their file section from the combined response.

### `search_symbol` guard

Outputs exceeding ~115% of budget are truncated with file hints and a nudge to narrow `path` or `target`.

## Development

```bash
cd assets/readbro
pnpm install
./run-tests              # Node tests (works when pnpm store is read-only)
pnpm run test:node       # same, via package script
pnpm run typecheck
pnpm run benchmark       # composto fixtures
bun run build && ./readbro gain
```

Nix build and check: `readbro-package.nix` at repo root — `pnpm fetchPnpmDeps` + `bun build --compile --minify --bytecode`, tests in `checkPhase`.

Workspace-local MCP override (repo root `.cursor/mcp.json`):

```json
{ "mcpServers": { "readbro": { "command": "node", "args": ["assets/readbro/src/main.ts"] } } }
```

## Architecture (sketch)

```
main.ts
  ├─ fast path → fast-stats.ts (gain / stats / clear / ls / sessions / doctor / audit / tips)
  └─ MCP / CLI → main-effect.ts → Effect + @effect/cli + @effect/ai
       └─ readbro.ts → cache.ts (SQLite) + ir.ts (composto) + format.ts
```

- **SQLite** (`sqlite.ts`): `node:sqlite` in tests, `bun:sqlite` in compiled binary.
- **IR** (`ir.ts`): shells out to `composto ir <path> <layer>`.
- **Stats** (`stats-query.ts`, `stats-aggregate.ts`): shared by CLI and MCP session tools.

---

## ADR: Node → Bun compile (perf)

**Problem:** `readbro gain` paid ~1.3 s every invocation — Node on-the-fly TS transform, full Effect / `@effect/cli` stack, hundreds of `node_modules` imports.

**Changes:**

1. **Single executable** — `bun build --compile --minify --bytecode` (`readbro-package.nix`). Nix still fetches deps with pnpm; Bun only compiles.
2. **SQLite adapter** — `node:sqlite` for Node tests; `bun:sqlite` in the binary (`node:sqlite` fails under `bun compile`).
3. **Fast path** — `gain`, `stats`, `clear`, `ls`, `sessions`, and `doctor` bypass Effect; `main.ts` routes to `fast-stats.ts` or lazy-loads `main-effect.ts` for MCP.

**Result (nix-built binary, warm):**

| Command | Before | After |
|---------|--------|-------|
| `readbro gain` | ~1.3 s | ~30 ms |
| `readbro stats` | ~1.3 s | ~30 ms |

Cold start ~700 ms (binary exec), then ~30 ms. MCP smoke-tested on compiled binary; tests 47/47.

---

## Ideas (maybe later)

| Idea | What it would do |
|------|------------------|
| `readbro watch gain` | Live-refreshing savings ticker for the current session (like `watch readbro gain --scope session`). |
| `--follow` on `ls` | Stream new usage events as they arrive (tail -f for MCP debugging). |

JSON export for CI/dashboards is already `--json` on `stats`, `gain`, `ls`, and `sessions` — no separate export command planned.
