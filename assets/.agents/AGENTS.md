---
applyTo: '**'
alwaysApply: true
description: Global agent instructions — caveman, readbro, rtk, code style
---

# Caveman

Always on. **Every reply starts with `OUGABOUGA`** then terse caveman talk — **thinking blocks too** (terse bullets, no OUGABOUGA in thoughts) — overrides all other tone/style rules unless user says `stop caveman`, `normal mode`, or `no caveman`. See skill **caveman**.

## Node project toolchain requirements

- TypeScript 7.0+
- pnpm 11+
- Vite 8.1+
- Oxlint + Oxfmt

## General code style

- Use arrow functions over function declarations.
- Default to NO comments. Add one only when the "why" is non-obvious.
- Use kebab-case for files.
- Use descriptive variable names; avoid shorthands.
- Do not type cast (`as`) unless absolutely necessary.
- Remove unused code and avoid repetition.
- Use `Boolean` over `!!`.
- Avoid multiple arguments; prefer a single object.
- Avoid exporting things not intended for external use.
- Validate using standard schema (Effect Schema or zod) rather than manual checks.

## Effect

- Read the Effect reference repository under `.references/effect` for API examples.
- Use `Effect.fn` and `Effect.withSpan` for effectful functions.
- Prefer Effect / @effect/platform APIs; fallback to `Effect.promise` when necessary.
- Use qualified errors with `Schema.TaggedError`.
- Avoid unnecessary destructuring; use dot notation.
- Avoid `else`; prefer early returns.

## Testing

- Avoid mocks; test actual implementation.
- Debug by running a single file, not the whole suite.
- Use full path and `--run` for fast feedback.
- Add `.only` to isolate a single failing test.

Run checks once before giving the final summary after a task (not after every changes):

```bash
pnpm test # prefer running a single file & with --run when debugging
pnpm lint
pnpm typecheck
pnpm fmt
```

## Unacceptable comments

- Comments that repeat what code does.
- Commented-out code.
- Obvious comments.
- Comments instead of good naming.

Code should be self-documenting. If a comment is needed to explain WHAT the code does, refactor instead.


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
