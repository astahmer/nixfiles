---
applyTo: '**'
alwaysApply: true
description: Global agent instructions — caveman, ast-outline, rtk, code style
---

- Always use `jj` instead of `git`; unless explicitly asked
- Always split & describe your work using jj revisions when you make changes

## Nix-backed debugging

This workstation has Nix and `comma` available, so a command missing from
`PATH` is not evidence that the capability is unavailable. Before installing
anything into a profile or stopping at "command not found", try a one-shot
Nix-backed invocation:

- `rtk comma <command> [args...]` resolves and runs the executable from
  nixpkgs without installing it; use `rtk comma -p <command>` or
  `rtk comma -x <command>` to identify the package or store path.
- `rtk nix run nixpkgs#<package> -- <args...>` runs a known package
  explicitly.
- `rtk nix shell nixpkgs#<package> --command <command> [args...]` provides a
  temporary environment for multi-tool debugging.
- `rtk nix develop` enters the repository's pinned development environment
  when the flake provides one.

Prefer these ephemeral paths for diagnostics. Keep profile changes and
configuration edits deliberate, and report the exact Nix/comma failure when a
tool genuinely cannot be resolved.

## Machine-setup fixes go in Nix

Any fix to this machine's setup — a missing CLI, a config change, a service
misbehaving, new tooling — belongs in the Nix setup, not in one-off global
installs (`npm i -g`, `pip install --user`, `brew install`, `cargo install`,
`nix profile install`, ...). Global installs are non-deterministic and
non-reproducible: the change lives only on this machine and won't survive a
reapply or transfer to another machine.

The Nix setup is this repository, reachable from any machine through the
stable symlink `~/.config/nixfiles` (env `NH_FLAKE`). Make the change in
`modules/` (shared behavior) or `hosts/` (per-machine wiring), then apply
with `nixapply` (macOS) or `nixos-switch` (NixOS) so every machine gets it on
the next apply.

If the tool is only needed for a one-off session, use the ephemeral `comma` /
`nix run` paths above instead of installing it globally.

<!-- ast-outline:start -->
## Code exploration — prefer `ast-outline` over full reads

For `.cs`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hh`, `.py`, `.pyi`,
`.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.kt`, `.kts`, `.scala`, `.sc`,
`.go`, `.rs`, `.php`, `.phtml`, `.rb`, `.rake`, `.gemspec`, `.ex`, `.exs`,
`.lua`, `.gd`, `.swift`, `.css`, `.scss`, `.sql`, `.html`, `.htm`, `.vue`,
`.md`, and `.yaml`/`.yml` files, read structure with `ast-outline` before
opening full contents.

Pick the smallest of these that answers your question — they're a
broad-to-narrow menu, not a sequence; skip straight to `show` when
you already know the symbol:

1. **Unfamiliar directory** — `ast-outline digest <paths…>`: one-page map
   of every file's types and public methods. Each file is tagged with a
   size label — `[tiny]` / `[medium]` / `[large]` / `[huge]` — plus
   `[broken]` when parse errors may have left the outline partial.
   `[huge]` files (≥100k tokens) collapse to header-only in the digest;
   call `ast-outline outline <path>` on them when you need full structure.
   Tune density with `--format=names|compact|default|wide` (alias
   `--oneline`=`names`) — `wide` adds private members and fields.

2. **File-level shape** — `ast-outline <paths…>`: signatures with line
   ranges, no bodies (2–10× smaller than a full read on non-trivial
   files). A `# WARNING: N parse errors` line in the header means the
   outline is partial — read the source for the affected region.

3. **One method, type, markdown heading, or yaml key** —
   `ast-outline show <file> <Symbol>`. Suffix matching: `TakeDamage`
   for one method; `User` for an entire type — class, struct, interface,
   trait, enum (whole body, useful when a file holds several types);
   `Player.TakeDamage` when ambiguous. Multiple at once:
   `ast-outline show Player.cs TakeDamage Heal Die`.
   For markdown, the symbol is heading text and matching is
   case-insensitive substring — `"installation"` finds
   `"2.1 Installation (macOS / Linux)"`. For yaml, the symbol is a
   dotted key path (`spec.containers[0].image`) — `show` matches keys,
   not values, so for free-text search inside values use `grep`.
   For css/scss, the symbol is a selector token (`.btn-primary`,
   `$var`) — pseudos and attribute filters are stripped, so
   `.btn-primary` finds the rule even when it carries `:hover` or
   nests in `.modal`.
   For html, the symbol is a CSS-selector token (`#hero`, `.site-nav`,
   `form`, `section#hero`, `[rel=stylesheet]`) — same vocabulary as
   css/scss; pseudo-classes and descendant combinators aren't
   supported (use the tag/id/class/attribute form the outline shows).
   For sql, the symbol is a table or column name (`users`,
   `users.email`) — `show users` returns the table definition,
   `show users.email` returns one column line.
   Add `--signature` to `show` (only there) to return header only
   (docs + attrs + signature, no body) — useful after `digest`, when
   you have the name and want the contract, not the implementation.

4. **Where a symbol appears** —
   `ast-outline grep <pattern> <paths…>`: matches grouped by enclosing
   class/function. Definitions are tagged `[def]`, imports `[import]`;
   calls and refs carry no tag (inferable from `(` after symbol).
   Use for "where is X defined", "who calls Y", "is Z dead code" —
   scope in the output spares follow-up reads. Comments filtered;
   string literals searched and tagged `[string]`, so config keys,
   translation strings and reflection targets are found too. Batch
   via repeatable `-e`:
   `ast-outline grep User.save -e User.load -e User.delete src/`.
   Narrow by classification with `--kind def|call|ref|import` (also
   accepts `--kind def,call`) — drops the post-filter step when you
   only want definitions, only call sites, etc.
   POSIX flags `-w` (whole word), `-l` (paths only), `-c` (counts),
   `-m N` (cap per file) work as in `grep` / `rg`. For non-symbol
   patterns use your default search strategy.

`outline` and `digest` accept multiple paths in one call (files and
directories, mixed languages OK) — batch instead of looping. Type
headers in both renderers carry inheritance as `: Base, Trait`, so the
shape of class hierarchies is visible without a separate query.

The renderers emit a compact skeleton (signatures + line ranges, no
bodies), so output is usually small — narrow with the tool's own flags
before piping to `head`. A `grep | head` cut is the costly one: it
hides matches the header still counts in `(N matches)`, so results look
complete but aren't — cap per file with `-m N` instead.

Narrow the walk with repeatable `--exclude <glob>`
(`.gitignore`-syntax, anchored at the project root) on `outline` /
`digest` / `grep` — e.g. `--exclude tests/ --exclude '*.gen.*'` to
skip test trees and generated files in one call. `!pattern` negates;
`.gitignore` is still honored by default — `--exclude` adds to it.

When you need to know **what a file pulls in** or **where a referenced
type / function comes from**, add `--imports` to `outline` or `digest`.
The file header gets an `imports:` line listing every
`import` / `use` / `using` statement verbatim in the language's native
syntax — `from .core import X`, `use foo::Bar`,
`import { X } from './foo'`, `use App\Foo`, `require_once 'config.php'`,
`require "json"`.
Read the imports, then call `outline` / `show` on the source file
instead of grepping for the definition. Skip the flag for routine
structure reads — it adds one line per file.

A trailing `[+ N conditional includes]` on the imports line means
N more dependencies live inside `if` / `try` / loop / function bodies
— read the file directly when you need the full dependency picture.

Fall back to a full read only when you need context beyond the body
`show` returned. `ast-outline help` for flags.
<!-- ast-outline:end -->

# Caveman

Always on. **Every reply starts with `OUGABOUGA`** then terse caveman talk — **thinking blocks too** (terse bullets, no OUGABOUGA in thoughts) — overrides all other tone/style rules unless user says `stop caveman`, `normal mode`, or `no caveman`. See skill **caveman**.

## User prompts — "next steps", "anything else?", "something else?"

When the user ends a task with an open-ended prompt like "next steps?", "anything else [to do/add/improve/change]?", "something else?", "anything remaining?", "what's next?" — treat this as a genuine invitation to:

- Suggest **additional improvements, refactors, tests, docs, or edge cases** that are worth doing
- Batch **all** suggestions in one message, not one-at-a-time

When the user asks "any [other] questions?" or "need anything from me?" — collect all pending unknowns and ask them in a **single batched message**. If a question can be answered by exploring the codebase, do that instead. If you have nothing, say "Nothing else — all good."

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

- Read the Effect reference repository under `~/.references/effect` for API examples.
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


<!-- papercuts:start -->
# Papercuts — file friction when you hit it

When you hit friction — a dead-end tool call, a broken link, a misleading doc,
a footgun config, a missing helper, anything that slows you down — file it
before moving on:

    papercuts add [--global] "<what you hit and what would have prevented it>" --tag <area>

Severity: `minor` (default) for annoyances, `major` for time sinks, `blocker`
for hard walls. Don't stop working; filing takes one line.

Check open papercuts at the start of each session and fix quick wins:

    papercuts list --format md

See the **papercuts** skill for full command reference.
<!-- papercuts:end -->

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
