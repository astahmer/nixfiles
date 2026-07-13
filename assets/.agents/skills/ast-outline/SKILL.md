---
name: ast-outline
description: >
  Tree-sitter-based CLI for code exploration — outlines, digests, symbol extraction, and
  AST-aware grep. Prefer over full file reads for structure.
---

# ast-outline

ast-outline is the primary code-structure tool. It replaces full file reads with compact
tree-sitter-based structural output for supported languages. Use it before opening full
file contents.

## Available tools

| Tool | Purpose |
|------|---------|
| `ast-outline <paths…>` | Default: signatures + line ranges, no bodies |
| `ast-outline digest <paths…>` | One-page module map with size labels |
| `ast-outline show <file> <Symbol…>` | Extract one or more symbol bodies |
| `ast-outline grep <pattern> <paths…>` | AST-aware structural search (grouped by scope) |
| `ast-outline prompt` | Print the canonical agent snippet for context files |

## Broad-to-narrow workflow

Start broad, drill only when needed:

1. **Unfamiliar directory** — `ast-outline digest src/`: one-page map of types and methods.
   Each file tagged `[tiny]` / `[medium]` / `[large]` / `[huge]`. `[huge]` files
   (≥100k tokens) collapse to header-only; call `ast-outline outline <path>` to expand.

2. **File-level shape** — `ast-outline src/foo.ts`: signatures with line ranges, 2-10x
   smaller than full read. A `# WARNING: N parse errors` means the outline is partial.

3. **One symbol** — `ast-outline show foo.ts MyClass`: extract just one type/method body.
   Suffix matching: `User` for the type, `TakeDamage` for one method, `Player.TakeDamage`
   when ambiguous. Multiple at once: `ast-outline show foo.ts TakeDamage Heal Die`.
   Add `--signature` for header only (docs + attrs + signature, no body).

4. **Where a symbol appears** — `ast-outline grep User.save src/`: matches grouped by
   enclosing scope, tagged `[def]` / `[import]`. Batch with `-e`:
   `ast-outline grep User.save -e User.load src/`. Narrow with `--kind def|call|ref|import`.

## Key features

- **Multiple paths in one call** — `outline` and `digest` accept mixed file/directory args
- **`--imports`** — shows `import`/`use`/`using` statements verbatim in native syntax
- **`--exclude <glob>`** — skip test trees, generated files (`--exclude tests/ --exclude '*.gen.*'`)
- **Language support** — `.cs`, `.cpp`/`.cc`/`.h`, `.py`, `.ts`/`.tsx`, `.js`/`.jsx`, `.java`,
  `.kt`, `.scala`, `.go`, `.rs`, `.php`, `.rb`, `.ex`/`.exs`, `.lua`, `.gd`, `.swift`,
  `.css`/`.scss`, `.sql`, `.html`, `.htm`, `.vue`, `.md`, `.yaml`/`.yml`
- **Cross-language inheritance** — type headers carry `: Base, Trait` in signatures
- **Batch grep** — repeatable `-e` flag for multi-pattern search in one tree walk

## Fallback

Fall back to native Read / Grep / Glob when `ast-outline` is unavailable
(`command not found`), or when dealing with unsupported file formats.

## Reference

Run `ast-outline help` for all flags and commands.
