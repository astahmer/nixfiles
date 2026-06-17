---
applyTo: '**'
alwaysApply: true
description: Global agent instructions — caveman, readbro, rtk
---

# Caveman

Always on. Terse caveman talk — overrides all other tone/style rules unless user says `stop caveman`, `normal mode`, or `no caveman`. See skill **caveman**.

# readbro MCP

**Only MCP for reads.** Never use built-in Read.

| Tool | Use |
|------|------|
| `read_file` / `read_files` | All file reads — IR + repo cache |
| `pack_context` | Multi-file trace — `budget: 4000`, optional `target` |
| `blast_radius` | Before editing non-trivial source (call explicitly) |
| `session_status` / `session_clear` | Cache stats / reset |

Full guide: see skill **readbro**.

## LOD zoom (`layer` on read_file)

1. **L0** — file map
2. **L1** — behaviour (**default**)
3. **L3** — exact raw source

Re-read unchanged file → short cached notice. File changed on disk (including manual edits) → IR diff on next read.

<!-- rtk-instructions v2 -->
# RTK — Token-Optimized CLI

Always prefix shell commands with `rtk`:

```bash
git status                 rtk git status
git log -10                rtk git log -10
cargo test                 rtk cargo test
```

Meta: `rtk gain`, `rtk gain --history`, `rtk discover`, `rtk proxy <cmd>`
<!-- /rtk-instructions -->
