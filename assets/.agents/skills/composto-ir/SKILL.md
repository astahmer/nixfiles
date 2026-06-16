---
name: composto-ir
description: Composto IR LOD zoom — L0 outline → L1 meaning → L2 delta → L3 exact source. Use instead of read_file unless user wants full raw file.
---

# Composto IR — level of detail (LOD)

Think **zoom on a file**. Start wide, drill in only when needed. Four layers (L0–L3), not five.

Use **`composto-cachebro` MCP `read_file`** (preferred) or `composto ir <file> <layer>` CLI.

## Layers

| Layer | ~tokens | Question | What you get |
|-------|---------|----------|--------------|
| **L0** | ~10 | "What's in this file?" | Names + line refs (FN, CLASS) |
| **L1** | ~85 | "What does it do?" | Compressed IR + health tags |
| **L2** | ~65 | "What changed?" | Git delta + surrounding IR + blame |
| **L3** | variable | "Show exact code" | Raw source (full file or line slice) |

Health tags on L1/L2 when file unhealthy: `[HOT:…]`, `[FIX:…]`, `[COV:↓]`, `[INCON]`.

## Zoom workflow (default)

```
1. New file / survey repo     → L0 (or L1 if file small & you need behaviour now)
2. Understand behaviour       → L1
3. Bug/regression/PR review   → L2 on changed files, L1 for neighbours
4. Need exact string/format   → L3 (whole file or function line range)
```

### Typical paths (from upstream composto)

| Task | LOD |
|------|-----|
| Architecture overview | L1 all relevant files |
| Fix a bug | L3 target file, L1 context files |
| Review a PR | L2 changed files, L1 context |
| Repo/file inventory | L0 everywhere |

### Multi-file trace

`composto_context` with `target: "<symbol-or-file>"` and `budget: 4000` — packs L0/L1/L3 mix automatically (target often L3, neighbours L0/L1).

## When NOT to zoom to L3 early

Stay L0/L1 until you know **which** function/block matters. Jump L3 only for:

- Exact error strings, regex, literals
- Format-sensitive edits
- User asked "show me the file"

## MCP call

```
composto_ir file=<path> layer=L0|L1|L2|L3
```

Default layer if omitted: **L1**.
