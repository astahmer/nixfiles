---
name: readbro
description: >
  IR-aware file reads via the readbro MCP server. Use read_file instead of the built-in
  Read tool. Supports LOD layers L0, L1, L3, session caching with diffs, search_symbol for
  named symbols, and blast_radius before edits. Never grep/rg for symbol names.
---

# readbro

readbro is the **only** MCP server you should use for reading files and finding named symbols in code. Do not use the IDE's built-in Read tool, Grep, SemanticSearch, or Glob to read source or trace named symbols — they return full raw text and waste context tokens.

readbro compresses source files into composto IR (intermediate representation), caches what has been read in the repo, and on re-reads returns either a short "unchanged" notice or a compact diff instead of the full file again.

## Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read one or more files (default layer L1) — `path` is string or array |
| `search_symbol` | Find named symbols (class, function, use-case) with IR context |
| `blast_radius` | Assess edit risk from git history before changing a file |
| `session_status` | Repo health snapshot — totals, efficiency, files tracked |
| `session_gain` | Where savings come from — top files, glob/path drill-down |
| `session_clear` | Reset the session cache |

## When NOT to use grep / Glob / SemanticSearch

| You want | Use instead |
|----------|-------------|
| Read a known file | `read_file` |
| Read several known files | `read_file({ path: ["a.ts", "b.ts"] })` — **one call** |
| Find `FooUseCase`, `handleAuth`, `rootInjectorCb` | `search_symbol({ target: "FooUseCase" })` |
| Trace symbol across repo | `search_symbol({ path: ".", target: "..." })` |
| Scope symbol to one file | `search_symbol({ path: "spec.ts", target: "..." })` |
| Several named symbols | `search_symbol({ targets: ["A", "B", "C"] })` |

**Still use grep/Glob for:** filename patterns (`**/*.spec.ts`), regex/substring text search, config keys, comments, non-symbol strings.

### `read_file` — primary read path

Always prefer this over built-in Read.

**Parameters:**

- `path` — file path (string) **or** array of paths for batch read (required)
- `layer` — `L0` | `L1` | `L3` (default `L1`; no L2 — see below)
- `force` — bypass cache and return full payload (default `false`)
- `max_lines` — cap output lines (`L3`/raw auto-capped to 200; `-1` = full file, no cap)
- `offset` — start at 0-based line (optional)

**Example — survey a module:**

```
read_file({ path: "src/auth/middleware.ts", layer: "L0" })
```

**Example — batch read (never parallel read_file calls):**

```
read_file({ path: ["src/a.ts", "src/b.ts", "src/c.ts"], layer: "L1" })
```

**Example — understand behaviour (default):**

```
read_file({ path: "src/auth/middleware.ts" })
```

**Example — need exact source (rare):**

```
read_file({ path: "src/auth/middleware.ts", layer: "L3" })
```

Layer L3 returns raw file content. **Avoid for exploration** — a 2500-line spec file can cost ~150K tokens. L3/raw auto-truncates to 200 lines unless `max_lines: -1`. Prefer L1; use `search_symbol` for cross-file symbol traces.

### `search_symbol` — named symbol search

Use **instead of grep/rg/SemanticSearch** when you know a symbol name.

`composto context` scans from a **directory** (repo root), not a single file path alone. To focus on one symbol in a known file, pass the file path **and** `target`:

```
search_symbol({ path: "src/auth/middleware.ts", budget: 4000, target: "handleAuth" })
```

Or search the whole repo:

```
search_symbol({ path: ".", budget: 4000, target: "ReplayAccountingImportUseCase" })
```

Multiple symbols in one call:

```
search_symbol({ path: "spec/", targets: ["UseCaseA", "UseCaseB"], budget: 8000 })
```

- `path` — directory (default `.`) or file + required `target`/`targets`
- `budget` — max tokens (default `4000`)
- `target` — single symbol, class, or function name
- `targets` — array of symbol names (budget split across them)

If the symbol is missing in a file, readbro appends **nearby symbol names** from that file and suggests repo-wide `search_symbol(path: ".", target: ...)`.

### `blast_radius` — before editing

Call before editing non-trivial source files (skip tests, generated code, lockfiles, `node_modules`, `dist`):

```
blast_radius({ file: "src/auth/middleware.ts", intent: "bugfix" })
```

Intent values: `refactor`, `bugfix`, `feature`, `test`, `docs`, `unknown`.

## LOD zoom workflow

Start broad, drill only when needed:

| Layer | What you get | When to use |
|-------|--------------|-------------|
| **L0** | File map — symbols, structure | Surveying unfamiliar code |
| **L1** | Compressed IR — behaviour | Default for understanding logic |
| **L3** | Exact raw source | **Rare** — small files or `max_lines`; never for survey |

**Why no L2?** composto's git-delta layer (`generateL2`) falls back to L1 because `composto ir` never passes `delta`. Post-edit savings come from readbro's session cache at L1 — re-read the same layer after an edit.

Typical flow:

```
1. read_file(path, L0)     → "what's in this file?"
2. read_file(path, L1)     → "how does it work?" (stop here most of the time)
3. read_file(path, L3)     → only tiny files or explicit line window
```

For unknown symbol location, start with `search_symbol` — not grep.

## CLI

`readbro` with no args starts the MCP server (Cursor/Copilot config unchanged).

| Command | Action |
|---------|--------|
| `readbro read <path>` | Read one file (`--layer`, `--force`) |
| `readbro reads <paths...>` | Batch read (same as `read_file` with path array) |
| `readbro symbol` | Symbol search (`--path`, `--budget`, `--target`) |
| `readbro context` | Deprecated alias for `symbol` |
| `readbro blast <file>` | Blast radius (`--intent`) |
| `readbro stats` | Repo health snapshot (summary; `--verbose` for breakdown) |
| `readbro gain` | Where savings come from — top files (`--verbose` for globs/recent) |
| `readbro clear` | Clear repo cache (`--path` optional) |
| `readbro mcp` | MCP server explicitly |

## Repo caching

readbro stores IR payloads in **`.readbro/cache.db` at the working-copy root**. **Billing is per MCP session**.

### First read in a session

Always returns the **full** IR/raw payload for that layer.

### Unchanged re-read (same session, same layer)

Short notice: `[readbro: unchanged IR (L1, ir), ~842 tokens saved]`

### After a file change

Returns a unified diff of the IR vs what this session last saw.

`force: true` skips the cache and always returns the full current payload.

### Cache management

```
session_status()   → repo health snapshot (totals, efficiency)
session_gain()     → top files + savings drill-down
session_clear()    → reset repo cache
```

## Non-code files

Markdown, YAML, Nix, and other non-code extensions have **no composto IR**. L1 returns raw with an advisory — use `max_lines` to cap plan docs, or `read_file` with a path array to batch them.

## Audit workflows

1. `read_file({ path: [...specs], layer: "L1" })` — one call for the spec batch
2. `search_symbol({ path: ".", target: "SomeUseCase" })` — cross-file traces
3. Shell trace scripts only for union counts readbro does not compute yet

## Quick reference

| Task | Tool |
|------|------|
| Survey repo | `read_file` L0 or L1 |
| Understand logic | `read_file` L1 (**default**) |
| Several files | `read_file` with path **array** |
| Find named symbol | `search_symbol` — **not grep** |
| Bug across files | `search_symbol` |
| Before editing | `blast_radius` |
| Bypass cache | `read_file` with `force: true` |
| Regex / text / filenames | grep / Glob (readbro does not replace these) |
