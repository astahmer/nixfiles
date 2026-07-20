---
name: papercuts
description: Agent complaint box — log friction (dead-end tools, wrong cwd, flaky commands, misleading docs) instead of silently pushing through. Use when you hit any workflow friction during a task.
---

# Papercuts

When you hit friction during work — a dead-end tool call, a broken link, a misleading doc, a footgun config, a missing helper — file it before moving on:

```bash
papercuts add "<what you hit and what would have prevented it>" --tag <area>
```

Don't stop working; file it and push through. Severity: `minor` (default) for annoyances, `major` for time sinks, `blocker` for hard walls.

## Commands

```bash
papercuts add [--global] <text> [--tag <area>] [--severity minor|major|blocker]
papercuts list [--global] [--format json|md] [--all]
papercuts resolve [--global] <id-prefix>
papercuts unresolvable [--global] <id-prefix> "<reason it cannot be fixed here>"
papercuts clean [--global]
papercuts schema
```

## Scope

Use the repository's `.papercuts.jsonl` only for friction rooted in that repository's code,
configuration, documentation, or workflow. Keep shell, agent, connector, editor, and other shared
tooling issues in the global file at `~/.papercuts.jsonl`:

```bash
papercuts add --global "<global issue>" --tag tooling
```

When moving an existing cut to the global file, move its `cut` record and every matching terminal
record (`resolve` or `unresolvable`) together. Do not copy project-specific cuts into the global file.

## Workflow

1. Hit friction → `papercuts add "..." --tag docs|tooling|config|api|other`
2. Keep working — filing takes one line
3. Periodically: `papercuts list --format md` to review
4. Fix the easy ones, resolve with `papercuts resolve <id>`
5. Mark an external or intentionally out-of-scope cut with `papercuts unresolvable <id> "<reason>"`.
   It disappears from the open list but remains in `--all`; `clean` preserves it for future context.

Each agent session should check open papercuts at the start and try to fix any that are quick wins.
