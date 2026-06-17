---
name: rtk
description: >
  Token-optimized shell via rtk. Always prefix Shell tool commands with rtk.
  Hook rewrites misses but agent must write rtk explicitly. Use for every shell command.
---

# RTK

RTK compresses noisy CLI output (git, cargo, test runners, etc.) so agents burn fewer tokens on command output.

**Always on.** Every Shell tool command must start with `rtk` unless the functionally impossible (e.g. already running `rtk` itself).

## Rule

Prefix **every** shell command with `rtk`:

```bash
rtk git status
rtk git log -10 --oneline
rtk git diff
rtk gain
rtk discover
rtk gain --history
rtk discover
rtk proxy <cmd>
rtk cargo test
rtk pnpm test
rtk flake check
rtk rg "pattern" .
```

No bare `git`, `cargo`, `pnpm`, `npm`, `rg`, etc. Write `rtk` in the command you emit — do not rely on the hook to fix it silently.

## Hook (safety net)

Cursor runs `rtk hook cursor` on Shell preToolUse. It can rewrite bare commands, but **you still write `rtk` yourself** — same as readbro for reads.

## Meta

| Command | Purpose |
|---------|---------|
| `rtk gain` | Token savings summary |
| `rtk gain --history` | Savings over time |
| `rtk discover` | Commands you forgot to wrap |
| `rtk proxy <cmd>` | One-off wrapper for unknown CLIs |

## Boundaries

- Code blocks in replies — show `rtk`-prefixed commands when suggesting commands to user
- Commit messages / PR text — normal (no rtk prefix in prose unless it's a literal command)
