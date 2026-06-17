---
name: readbro
description: >
  IR-aware file reads via the readbro MCP server. Use read_file instead of the built-in
  Read tool. Supports LOD layers L0–L3, session caching with diffs, pack_context for
  multi-file traces, and blast_radius before edits.
---

# readbro

readbro is the **only** MCP server you should use for reading files. Do not use the IDE's built-in Read tool or read tools from other MCP servers — they return full raw source every time and waste context tokens.

readbro compresses source files into composto IR (intermediate representation), caches what has been read in the repo, and on re-reads returns either a short "unchanged" notice or a compact diff instead of the full file again.

## Tools

| Tool | Purpose |
|------|---------|
| `read_file` | Read one file (default layer L1) |
| `read_files` | Batch read several paths with the same layer |
| `pack_context` | Pack multiple files into a token budget for bug traces |
| `blast_radius` | Assess edit risk from git history before changing a file |
| `session_status` | Repo health snapshot — totals, efficiency, files tracked |
| `session_gain` | Where savings come from — top files, glob/path drill-down |
| `session_clear` | Reset the session cache |

### `read_file` — primary read path

Always prefer this over built-in Read.

**Parameters:**

- `path` — file to read (required)
- `layer` — `L0` | `L1` | `L2` | `L3` (default `L1`)
- `force` — bypass cache and return full payload (default `false`)
- `max_lines` — cap output lines (`L3`/raw auto-capped to 200; `-1` = full file, no cap)
- `offset` — start at 0-based line (optional)
- `target` — optional symbol/class name → runs `composto context` from repo root (use instead of L3 for one symbol)
- `budget` — token budget when `target` is set (default `4000`)

**Example — survey a module:**

```
read_file({ path: "src/auth/middleware.ts", layer: "L0" })
```

Returns a structural outline: exports, classes, functions — enough to decide whether to drill deeper.

**Example — understand behaviour (default):**

```
read_file({ path: "src/auth/middleware.ts" })
```

Layer L1 returns compressed IR describing what the file does, not every line of source.

**Example — need exact source (rare):**

```
read_file({ path: "src/auth/middleware.ts", layer: "L3" })
```

Layer L3 returns raw file content. **Avoid for exploration** — a 2500-line spec file can cost ~150K tokens. L3/raw auto-truncates to 200 lines unless `max_lines: -1`. Prefer L1; use `pack_context` for multi-file traces.

**Example — line window on raw:**

```
read_file({ path: "src/big.spec.ts", layer: "L3", max_lines: 120, offset: 0 })
```

**Example — force refresh after external change:**

```
read_file({ path: "src/auth/middleware.ts", force: true })
```

### `read_files` — batch reads

When you need several files at once, prefer one `read_files` call over many `read_file` calls:

```
read_files({ paths: ["src/a.ts", "src/b.ts", "src/c.ts"], layer: "L1" })
```

### `pack_context` — symbol search & multi-file bug traces

`composto context` scans from a **directory** (repo root), not a single file path. To focus on one symbol in a known file, pass the file path **and** `target`:

```
pack_context({ path: "src/auth/middleware.ts", budget: 4000, target: "handleAuth" })
```

Or search the whole repo:

```
pack_context({ path: ".", budget: 4000, target: "ReplayAccountingImportUseCase" })
```

Same via `read_file` with `target` (delegates to `pack_context`).

- `path` — directory (default `.`) or file + required `target`
- `budget` — max tokens (default `4000`)
- `target` — symbol, class, or function name to focus (required when `path` is a file)

### `blast_radius` — before editing

Call before editing non-trivial source files (skip tests, generated code, lockfiles, `node_modules`, `dist`):

```
blast_radius({ file: "src/auth/middleware.ts", intent: "bugfix" })
```

Intent values: `refactor`, `bugfix`, `feature`, `test`, `docs`, `unknown`.

- **high** — warn the user; many downstream dependents or fragile history
- **medium** — brief note in your response
- **low** — proceed normally

There is no automatic hook for this — you must call the tool (or rely on your own judgement for trivial edits).

## LOD zoom workflow

Start broad, drill only when needed:

| Layer | What you get | When to use |
|-------|--------------|-------------|
| **L0** | File map — symbols, structure | Surveying unfamiliar code |
| **L1** | Compressed IR — behaviour | Default for understanding logic |
| **L2** | Delta intent (may fall back) | After edits; prefer re-read at L1 |
| **L3** | Exact raw source | **Rare** — small files or `max_lines`; never for survey |

Typical flow:

```
1. read_file(path, L0)     → "what's in this file?"
2. read_file(path, L1)     → "how does it work?" (stop here most of the time)
3. read_file(path, L3)     → only tiny files or explicit line window, or max_lines: -1 when you really need all raw
```

**Drilling L0 → L1 → L3 is fine** when you need more detail. Within the same session, zooming to a higher layer returns an IR **diff** from the last lower layer (not the full payload again). Avoid hopping layers without drilling — e.g. reading L1, then L2, then L3 when L1 already answered the question wastes tokens.

## CLI

`readbro` with no args starts the MCP server (Cursor/Copilot config unchanged).

| Command | Action |
|---------|--------|
| `readbro read <path>` | Read one file (`--layer`, `--force`) |
| `readbro reads <paths...>` | Batch read |
| `readbro context` | Pack context (`--path`, `--budget`, `--target`) |
| `readbro blast <file>` | Blast radius (`--intent`) |
| `readbro stats` | Repo health snapshot (summary; `--verbose` for breakdown) |
| `readbro gain` | Where savings come from — top files (`--verbose` for globs/recent) |
| `readbro clear` | Clear repo cache (`--path` optional) |
| `readbro mcp` | MCP server explicitly |

## Repo caching

readbro stores IR payloads in **`.readbro/cache.db` at the working-copy root** (git clone, git worktree, jj repo, or jj workspace each get their own cache. `READBRO_DIR` overrides). **Billing is per MCP session** — each agent conversation has its own `session_id` (or `READBRO_SESSION_ID`).

### First read in a session

Always returns the **full** IR/raw payload for that layer, even if another session read the same file earlier.

### Unchanged re-read (same session, same layer)

If you read the same file at the same layer again and the **file on disk has not changed**, readbro returns a short notice:

```
[readbro: unchanged IR (L1, ir), ~842 tokens saved]
```

### After a file change (same session, same layer)

Returns a unified diff of the IR vs what this session last saw at that layer:

```
[readbro: 3 IR lines changed, layer L1, ir]
--- src/auth/middleware.ts
+++ src/auth/middleware.ts
...
```

### Layer zoom (same session, same file hash)

When you drill L0 → L1 (or L1 → L2, etc.) in one session, readbro sends a **zoom diff** from the prior layer instead of repeating everything:

```
[readbro: zoom L0→L1, 12 IR lines, ir]
```

### New session vs warm repo

Session A reads `src/auth.ts` → full IR. Session B (new conversation) reads the same unchanged file → **full IR again** (B has not seen it yet). Session B's second read → unchanged notice.

`ir_versions` in the DB is shared across sessions (for diff computation); **what gets billed** is session-scoped.

`force: true` skips the cache and always returns the full current payload.

### Cache management

```
session_status()   → repo health snapshot (totals, efficiency)
session_gain()     → top files + savings drill-down
session_clear()    → reset repo cache
```
## Quick reference

| Task | Tool |
|------|------|
| Survey repo | `read_file` L0 or L1 |
| Understand logic | `read_file` L1 (**default**) |
| Exact source | `read_file` L3 + `max_lines` (avoid bare L3 on large files) |
| Bug across files | `pack_context` |
| Before editing | `blast_radius` |
| Bypass cache | `read_file` with `force: true` |
| Find one symbol | `read_file` or `pack_context` with `target` |
