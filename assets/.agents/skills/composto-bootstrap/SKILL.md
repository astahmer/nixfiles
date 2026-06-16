---
name: composto-bootstrap
description: Composto session primer — points to IR LOD workflow and trends. MCP tools do execution; skills say when.
---

# Composto bootstrap

Composto = IR compression + git-history blast radius. **MCP runs tools. Skills say when.**

## MCP tools (use these)

| Tool | When |
|------|------|
| `composto_ir` | Read/explore code at chosen LOD (see `composto-ir` skill) |
| `composto_context` | Multi-file bug/trace — `target` + `budget: 4000` |
| `composto_blastradius` | Before editing non-trivial source |

Skip `composto_benchmark` unless user asks token stats.

## Skills (workflow only)

- **`composto-ir`** — LOD zoom: L0→L1→L2→L3. Start here for reads.
- **`composto-trends`** — Before refactor / recurring-bug hunt.

## Hooks

Edit/Write hooks already run blast radius. Still call `composto_blastradius` when unsure — hook may passthrough on low/unknown.
