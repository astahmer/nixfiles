# readbro

IR-aware read cache for coding agents — MCP server plus CLI. Compresses source through [composto](https://github.com/composto-ai/composto) IR, caches reads per session, and returns diffs on re-read instead of shipping the full file again.

## Why

Agent file reads are expensive: every `Read` call sends raw source into context. readbro defaults to **L1 behaviour IR** (~10–50× smaller than raw), tracks what each session has already seen, and on repeat reads returns an **unchanged notice** or a **compact IR diff** — session diff semantics inspired by [cachebro](https://github.com/glommer/cachebro). `pack_context` and `blast_radius` round out exploration and edit safety.

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
| `read_file` | Read one file (default **L1**). Primary replacement for built-in Read. |
| `read_files` | Batch read; same layer/options for all paths. |
| `pack_context` | Multi-file / symbol-aware context within a token budget. |
| `blast_radius` | Git-history risk before editing a file. |
| `session_status` | Repo health — totals, efficiency, files tracked. |
| `session_gain` | Where savings come from — top files, glob drill-down. |
| `session_clear` | Reset repo cache. |

### `read_file` parameters

| Param | Default | Notes |
|-------|---------|-------|
| `path` | — | Required. |
| `layer` | `L1` | `L0` structure · `L1` behaviour · `L2` delta · `L3` raw. |
| `force` | `false` | Bypass cache; always return full payload. |
| `max_lines` | — | Cap output lines. L3 auto-caps at 200 unless `-1`. |
| `offset` | — | 0-based line offset (L3 windows). |
| `target` | — | Symbol name → delegates to `pack_context` / `composto context`. |
| `budget` | `4000` | Token budget when `target` is set. |

**Prefer L1 for understanding code.** Use L3 only for small files or explicit line windows — a large spec at L3 can cost hundreds of thousands of tokens.

### IR layers (LOD)

| Layer | Content | When |
|-------|---------|------|
| **L0** | Structure — exports, classes, functions | Survey unfamiliar files |
| **L1** | Behaviour IR | **Default** — how code works |
| **L2** | Delta intent | After edits; usually re-read at L1 instead |
| **L3** | Raw source | Rare — tiny files or `max_lines` window |

Typical flow: L0 → L1, stop. Drill to L3 only when you need exact text.

### Session cache

Cache lives at **`.readbro/cache.db`** in the working-copy root (`READBRO_DIR` overrides). Billing is **per MCP session** (`READBRO_SESSION_ID` optional).

- **First read** in a session → full IR for that layer.
- **Unchanged re-read** → short notice (`~N tokens saved`).
- **File changed** → unified IR diff vs last session read.
- **Layer zoom** (L0→L1 in same session) → zoom diff, not full payload again.
- **New session** on warm repo → full IR again (that session hasn't seen the file yet).

`session_status` / `session_gain` / `session_clear` manage and inspect the cache.

## CLI

Fast path (`gain`, `stats`, `clear`, `ls`, `sessions`) skips Effect startup (~30 ms warm). MCP and other commands load the full stack lazily.

| Command | Action |
|---------|--------|
| `readbro` | MCP server (stdio) |
| `readbro mcp` | MCP server explicitly |
| `readbro read <path>` | Read one file (`--layer`, `--force`) |
| `readbro reads <paths…>` | Batch read |
| `readbro context` | Pack context (`--path`, `--budget`, `--target`) |
| `readbro blast <file>` | Blast radius (`--intent`) |
| `readbro stats` | Repo health snapshot (`--verbose`, filters) |
| `readbro gain` | Top savings (`--verbose` for globs) |
| `readbro ls` | Recent command/tool usage (`-n`, `--grep`, `--session`) |
| `readbro sessions` | Recent session ids with savings (`--limit`, `--skip`) |
| `readbro clear` | Clear cache (`--path`, `--older-than 7d`) |

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
  ├─ fast path → fast-stats.ts (gain / stats / clear / ls / sessions)
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
3. **Fast path** — `gain`, `stats`, `clear`, `ls`, and `sessions` bypass Effect; `main.ts` routes to `fast-stats.ts` or lazy-loads `main-effect.ts` for MCP.

**Result (nix-built binary, warm):**

| Command | Before | After |
|---------|--------|-------|
| `readbro gain` | ~1.3 s | ~30 ms |
| `readbro stats` | ~1.3 s | ~30 ms |

Cold start ~700 ms (binary exec), then ~30 ms. MCP smoke-tested on compiled binary; tests 37/37.
