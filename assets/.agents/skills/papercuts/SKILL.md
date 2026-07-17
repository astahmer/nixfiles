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
papercuts add "<text>" [--tag <area>] [--severity minor|major|blocker]
papercuts list [--format json|md] [--all]
papercuts resolve <id-prefix>
papercuts clean
papercuts schema
```

## Workflow

1. Hit friction → `papercuts add "..." --tag docs|tooling|config|api|other`
2. Keep working — filing takes one line
3. Periodically: `papercuts list --format md` to review
4. Fix the easy ones, resolve with `papercuts resolve <id>`

Each agent session should check open papercuts at the start and try to fix any that are quick wins.
