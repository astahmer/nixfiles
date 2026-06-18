---
description: readbro MCP — IR reads, symbol search, blast radius
alwaysApply: true
---

# readbro

Single MCP for file reads. **Never use built-in Read, Grep, SemanticSearch, or Glob for code you can reach via readbro.**

## Plan pass (before reads)

Multi-file task? **Plan paths first**, then one survey batch — saves round-trips and tokens.

1. **Plan** — list files you'll likely touch (task scope, errors, `blast_radius`, filenames)
2. **Batch** — `read_file({ paths: ["a.ts", "b.ts"], layer: "L1" })` in **one** call
3. **Drill** — `search_symbol` / `target` / `around_line` / `ranges` only when L1 is not enough
4. **Edit** — re-read changed spots with `around_line` or `ranges`, not whole-file `force`

**Parallel `read_file` tool calls ≠ batch.** Only `paths: [...]` in a single call counts.

## Pick the tool first

| You know… | Use |
|-----------|-----|
| **Symbol / class / function name** | `search_symbol({ target })` — **default for precise lookup** |
| **File + symbol** | `read_file({ path, target })` — shorthand for search |
| **Several file paths** | `read_file({ paths: [...] })` — **one call**, L1 survey |
| **One file, exploring** | `read_file` L0 or L1 |
| **Regex / substring / filename** | grep / Glob / `find` (paths by name) |

`find` lists filesystem paths — not a `search_symbol` substitute. `search_symbol` is for **named code symbols** only.

**Do not** open a whole file at L1 or grep when a `target` would answer the question directly.

| Tool | When |
|------|------|
| `search_symbol` | **First choice** for named symbols — not grep |
| `read_file` | File reads; `path`/`paths` string or **array**; optional `target` delegates to search |
| `blast_radius` | Before editing non-trivial source |
| `session_status` | Repo health snapshot |
| `session_gain` | Where savings come from |
| `session_clear` | Clear repo cache |

Full guide: `~/.agents/skills/readbro/SKILL.md`
