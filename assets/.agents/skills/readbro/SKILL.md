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
| `session_status` | Show cache stats (files tracked, tokens saved) |
| `session_clear` | Reset the session cache |

### `read_file` — primary read path

Always prefer this over built-in Read.

**Parameters:**

- `path` — file to read (required)
- `layer` — `L0` | `L1` | `L2` | `L3` (default `L1`)
- `force` — bypass cache and return full payload (default `false`)

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

**Example — need exact source:**

```
read_file({ path: "src/auth/middleware.ts", layer: "L3" })
```

Layer L3 returns raw file content. Use only when you need exact strings, formatting, or line-accurate edits.

**Example — force refresh after external change:**

```
read_file({ path: "src/auth/middleware.ts", force: true })
```

### `read_files` — batch reads

When you need several files at once, prefer one `read_files` call over many `read_file` calls:

```
read_files({ paths: ["src/a.ts", "src/b.ts", "src/c.ts"], layer: "L1" })
```

### `pack_context` — multi-file bug traces

Use when a bug spans multiple files and you need neighbours packed within a token budget:

```
pack_context({ path: ".", budget: 4000, target: "handleAuth" })
```

- `path` — project root (default `.`)
- `budget` — max tokens (default `4000`)
- `target` — optional symbol or file to focus; that file stays raw, neighbours are IR

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
| **L3** | Exact raw source | Strings, formatting, precise line edits |

Typical flow:

```
1. read_file(path, L0)     → "what's in this file?"
2. read_file(path, L1)     → "how does it work?"
3. read_file(path, L3)     → only if L1 isn't enough for the edit
```

## Repo caching

readbro stores read state in **`.readbro/cache.db` at the working-copy root** — git clone, git worktree, jj repo, or jj workspace each get their own cache. Shared across all agent sessions in that working copy (`READBRO_DIR` overrides location).

If session A reads `src/auth.ts` and session B reads the same unchanged file later, session B gets the short "unchanged" notice instead of the full IR again.

### Unchanged re-read

If you read the same file at the same layer again and the **file content on disk has not changed**, readbro returns a short notice instead of the full IR:

```
[readbro: unchanged IR (L1, ir), ~842 tokens saved]
```

### After a change — IR diff

If the file changed since your last read at that layer, readbro returns a unified diff of the IR (not necessarily the raw source diff):

```
[readbro: 3 IR lines changed, layer L1, ir]
--- src/auth/middleware.ts
+++ src/auth/middleware.ts
...
```

### Manual edits (no agent involved)

**Yes — external changes are detected automatically.** On every `read_file` call, readbro reads the file from disk and hashes its content (`SHA-256`, truncated). The cache compares this hash to the last read hash **for that repo** (any prior session counts).

Worktrees/workspaces don't share cache — different files on disk. Sessions in same working copy still share cache.

- User edits a file in their editor → next `read_file` sees new hash → returns diff or full IR
- User saves outside the agent → same behaviour
- No watcher or hook is required; detection happens at read time

`force: true` skips the cache and always returns the full current payload.

### Cache management

```
session_status()   → files tracked, tokens saved in repo cache
session_clear()    → reset repo cache (optional path scopes to one git root)
```
## Quick reference

| Task | Tool |
|------|------|
| Survey repo | `read_file` L0 or L1 |
| Understand logic | `read_file` L1 |
| Exact source | `read_file` L3 |
| Bug across files | `pack_context` |
| Before editing | `blast_radius` |
| Bypass cache | `read_file` with `force: true` |
| Find hotspots | `composto trends .` then `read_file` |
