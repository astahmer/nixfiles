---
name: readbro-trends
description: Codebase health trends before refactor or recurring-bug hunts. Uses composto CLI locally.
---

# readbro trends

Git-history hotspots — zero LLM tokens, local only.

```bash
composto trends .
```

## When

- Before refactor — find files that actually need it
- Recurring bugs — locate hotspot
- Sprint planning — tech debt priorities

## After hotspots found

1. `readbro` `read_file` on hotspot (L1)
2. IR may include `[HOT:…]` `[FIX:…]` health tags
3. Consider `blast_radius` before editing
