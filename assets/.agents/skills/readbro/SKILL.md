---
name: readbro
description: >
  IR-aware file reads via the readbro MCP server. Use read_file instead of the built-in
  Read tool. search_symbol is the default for precise named-symbol lookup (Never grep/rg for symbol names). Supports LOD
  layers L0–L3, session caching with diffs, and blast_radius before edits.
---

# readbro

(IF ENABLED) readbro is the **only** MCP server you should use for reading files and finding named symbols in code. Do not use the IDE's built-in Read tool, Grep, SemanticSearch, or Glob to read source or trace named symbols — they return full raw text and waste context tokens.

readbro compresses source files into composto IR (intermediate representation), caches what has been read in the repo, and on re-reads returns either a short "unchanged" notice or a compact diff instead of the full file again.

## Plan pass → batch → drill → edit

Before serial `read_file` calls, **plan which files you'll touch** and batch them. Each serial call costs a round-trip even on cache hit; one `paths` array saves round-trips and keeps related context together.

1. **Plan** — list likely files (task scope, stack traces, `blast_radius`, filename grep)
2. **Batch survey** — `read_file({ paths: ["a.ts", "b.ts"], layer: "L1" })` in **one** call
3. **Drill** — `search_symbol`, `target`, `around_line`, or `ranges` when L1 is not enough
4. **Edit** — re-read only changed spots with `around_line` / `ranges`; avoid whole-file `force`

**Parallel `read_file` tool calls ≠ batch.** Only `paths: [...]` in a single call counts.

```
# Good — one round-trip
read_file({ paths: ["src/tips.ts", "src/mcp.ts", "src/readbro.ts"], layer: "L1" })

# Bad — three round-trips
read_file({ path: "src/tips.ts" })
read_file({ path: "src/mcp.ts" })
read_file({ path: "src/readbro.ts" })
```

**Workflows:**

- **Named thing?** → `search_symbol({ target: "..." })` first
- **Known paths?** → one `read_file` batch at L1 — never parallel `read_file`
- **Test failure?** → `search_symbol({ target: "FailingClass" })` + `read_file({ paths: ["spec.ts", "impl.ts"], layer: "L1" })`
- **Regex / union counts** → grep or shell trace scripts

**Anti-patterns:** `search_symbol` then many serial `read_file` calls for paths you already know; offset pagination on the same file — use `around_line` or `ranges` instead.

## Pick the tool first

Before reaching for read_file L1 or grep, ask what you know:

| You know… | Use | Example |
|-----------|-----|---------|
| **A symbol / class / function / use-case name** | `search_symbol` | `search_symbol({ target: "IrLayer" })` |
| **File path + symbol** | `read_file` + `target` | `read_file({ path: "spec.ts", target: "rootInjectorCb" })` |
| **Several file paths, no symbol** | `read_file` path array | `read_file({ paths: ["a.ts", "b.ts"], layer: "L1" })` |
| **A file path, exploring blindly** | `read_file` L0 or L1 | `read_file({ path: "src/foo.ts" })` |
| **Regex, substring, or filename pattern** | grep / Glob / `find` | `grep "TODO:"`, `Glob **/*.spec.ts`, `find . -name '*.test.ts'` |

**`find` is for filesystem discovery** (list paths by name/type/size) — not a substitute for `search_symbol`. Use `search_symbol` only when you know a **symbol name** in code.

**Default for audits and precise questions:** `search_symbol` (or `read_file` with `target`) — not grep, not a whole-file L1 read.

## Tools

| Tool | Purpose |
|------|---------|
| `search_symbol` | **Default for precise lookup** — named symbols with IR context |
| `read_file` | Read file(s); optional `target` delegates to symbol search |
| `blast_radius` | Assess edit risk from git history |
| `session_status` | Repo health snapshot |
| `session_gain` | Where savings come from |
| `session_clear` | Reset session cache |

### `search_symbol` — precise lookup (prefer this)

Use when you know **what** you're looking for by symbol name — preferred **instead of grep/rg/SemanticSearch**:

```
search_symbol({ target: "InvolveNajarInPurchaseProjectUseCase" })
search_symbol({ path: "assets/readbro", target: "IrLayer" })
search_symbol({ path: "spec/", target: ["UseCaseA", "UseCaseB"], budget: 4000 })
```

- `target` — one symbol name, or array for multiple (full budget each; parallel composto calls)
- `path` — scope to directory (default `.`) or file
- `budget` — token budget (default `4000`)

**Still use grep/Glob for:** filename patterns (`**/*.spec.ts`), regex/substring text search, config keys, comments, non-symbol strings.

### `read_file` — file reads

Always prefer this over built-in Read when you know where to look (but maybe not what to look for).

**Parameters:**

- `path` / `paths` — string or **array** of paths (batch in one call); `paths` is the preferred name for arrays
- `layer` — `L0` \| `L1` \| `L2` \| `L3` (default `L1` for exploratory reads)
- `target` / `budget` — **shorthand for search_symbol** (single path only; `target` string or array)
- `force` — rare; bypass cache for full payload. After edits prefer `around_line` / `ranges` over whole-file re-reads
- `full` — full raw read (implies `L3`, no line cap); use only for small files
- `around_line` / `context` — center on stack-trace line (implies `L3`, default ±40 lines)
- `ranges` — `[[start,end], ...]` or symbol names (resolved via L0)
- `max_lines` — cap output lines (`L3`/raw auto-capped to 200; `-1` or `full: true` = no cap)
- `offset` — start at 0-based line (optional)

**Symbol in known file:**

```
read_file({ path: "spec.ts", target: "rootInjectorCb" })
```

**Batch read (never parallel read_file calls):**

```
read_file({ paths: ["src/a.ts", "src/b.ts"], layer: "L1" })
```

**Exploratory (no symbol yet):**

```
read_file({ path: "src/auth/middleware.ts", layer: "L0" })  // survey
read_file({ path: "src/auth/middleware.ts" })                 // L1 behaviour
```


Layer L3 returns raw file content. **Avoid for exploration** — a 2500-line spec file can cost ~150K tokens. L3/raw auto-truncates to 200 lines unless `max_lines: -1`. Prefer L1; use `search_symbol` for cross-file symbol traces.

### `blast_radius` — before editing

Call before editing non-trivial source files (skip tests, generated code, lockfiles, `node_modules`, `dist`):

```
blast_radius({ file: "src/auth/middleware.ts", intent: "bugfix" })
```

Intent values: `refactor`, `bugfix`, `feature`, `test`, `docs`, `unknown`.

## LOD layers (exploratory reads only)

When you **don't** have a symbol name yet, start broad, drill only when needed:

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
When you **do** have a symbol name, skip LOD — use `search_symbol` or `read_file` + `target`.

## When NOT to use grep

| Don't grep for… | Do instead |
|-----------------|------------|
| `FooUseCase`, `handleAuth`, `IrLayer` | `search_symbol({ target: "..." })` |
| "where is class X defined" | `search_symbol` |
| "what uses symbol Y in this file" | `read_file({ path, target: "Y" })` |

**Still grep for:** regex patterns, string literals, comments, config keys, filename discovery.



## CLI

`readbro` with no args starts the MCP server (Cursor/Copilot config unchanged).

| Command | Action |
|---------|--------|
| `readbro read <paths...>` | Read one or more files (`--layer`, `--force`, `--target`) |
| `readbro symbol` | Symbol search (`--path`, `--budget`, `--target`) |
| `readbro context` | Deprecated alias for `symbol` |
| `readbro blast <file>` | Blast radius (`--intent`) |
| `readbro stats` | Repo health snapshot (summary; `--verbose` for breakdown) |
| `readbro gain` | Where savings come from — top files (`--verbose` for globs/recent) |
| `readbro clear` | Clear repo cache (`--path` optional) |
| `readbro ls` | Command/tool usage history (CLI + MCP) |
| `readbro sessions` | MCP agent sessions only (`--all` for CLI too) |
| `readbro tips` | List all workflow tips (MCP shows one per tool call) |
| `readbro audit` | Session read-pattern forensics (repeat paths, batch opportunities) |
| `readbro mcp` | MCP server explicitly |

## Repo caching

readbro stores IR payloads in **`.readbro/cache.db` at the working-copy root**. **Billing is per MCP session**.

### First read in a session

Always returns the **full** IR/raw payload for that layer.

### Unchanged re-read (same session, same layer)

Short notice; on 2nd+ read includes read number, layers/windows already fetched, and suggested next action.

### After a file change

Returns a unified diff of the IR vs what this session last saw.

`force: true` bypasses cache (rare). Prefer `around_line` / `ranges` to fetch exact lines after edits.

### MCP tips

Every MCP tool response may end with:

- `[readbro tip] …` — one random workflow hint (unseen tips first; pool reshuffles when exhausted)
- `[readbro hint] …` — serial reads OR repeat path in session (batch / `around_line` nudge)
- `[readbro session] …` — periodic footer: read count, unique paths, batches, est. extra round-trips; reminds that parallel calls ≠ batch

List all tips: `readbro tips` (or `readbro tips --json`).

### Cache management

```
session_status()   → repo health snapshot (totals, efficiency)
session_gain()     → top files + savings drill-down
session_clear()    → reset repo cache
```

## Language support (composto + readbro)

| Format | L1 compressor |
|--------|----------------|
| TypeScript / TSX / JS | composto tree-sitter IR |
| Python, Go, Rust | composto (basic) |
| Markdown / MDX | readbro `md-ir` — headings, links, code blocks |
| JSON, YAML, Nix, etc. | **no IR** — raw with advisory; use `max_lines` |

Markdown L0 = heading outline. Markdown L1 = section summaries + links + fenced-code stubs (no full prose).

## Quick reference

| Task | Tool |
|------|------|
| Know symbol name | `search_symbol` (**default**) |
| File + symbol | `read_file` + `target` |
| Several known files | `read_file` with `paths: [...]` |
| Explore unknown file | `read_file` L0 → L1 |
| Understand logic | `read_file` L1 |
| Regex / text / filenames | grep / Glob |
| Before editing | `blast_radius` |
| Exact lines after edit | `around_line` / `ranges` |
| Small file, full raw | `read_file` with `full: true` |
| Session batching audit | `readbro audit` CLI |
