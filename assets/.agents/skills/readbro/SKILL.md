---
name: readbro
description: IR-aware file reads via readbro MCP. Default L1. Use read_file instead of built-in Read. LOD zoom L0→L1→L3.
---

# readbro — reads

**Always** `readbro` MCP `read_file` — never built-in Read.

## LOD zoom

| Layer | When |
|-------|------|
| **L0** | Survey — what's in file |
| **L1** | Default — what file does |
| **L3** | Exact source — strings, formatting |

Start L0/L1. Drill L3 only when needed.

Re-read same unchanged file → short cached notice. After edit → IR diff.

## Other tools

- `read_files` — batch reads
- `pack_context` — bug/trace across files (`budget: 4000`, optional `target`)
- `blast_radius` — before edits (hooks also run this)
- `force=true` on `read_file` — bypass cache

## Flow

```
Survey repo     → read_file L0 or L1
Understand      → read_file L1
Need exact code → read_file L3
Bug across files → pack_context
Before edit     → blast_radius
```
