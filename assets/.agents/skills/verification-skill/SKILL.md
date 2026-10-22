---
name: verification-skill
description: Create or maintain a project-local verification skill (verify-<app>) — the scripted CLI and feature map that let an agent launch, check, drive, capture evidence from and clean up the real app. Use when a project has no reliable end-to-end proof, when agents keep hand-building the same dev environment, after changing dev/e2e fixtures, seed data, auth, the verification CLI or its feature catalog, or when a verification run failed because the skill or map drifted.
---

# Verification skill

One closed loop, two modes: **create** it when the project has none, **maintain**
it as the last step of a change that touched how the app is launched, seeded,
driven or verified. Both modes end in a live pass with evidence. Unexecuted
means draft.

## Principles

- **Build the lever.** Prefer commands over prose. Every step an agent would
  otherwise improvise (start, seed, log in, navigate, capture, stop) becomes a
  script or CLI subcommand in the repository.
- **Real user path.** Drive the UI, API or CLI that users use; no test-only
  endpoint that skips the behavior under test.
- **Isolated and owned.** Scratch instance, own data directory and port. Never
  touch the user's running instance or real data. Stop only what you started.
- **Evidence stays.** Screenshots, traces, logs and command output go to a
  known directory and are reported by path.
- **One source of truth.** The code decides paths; the skill decides how to
  drive them; the feature map is the only map.

## Create

1. **Inventory what exists.** README, dev scripts, e2e fixtures, seed data,
   test helpers, feature catalog. Wrap them; do not fork them.
2. **Choose the runtime handle.** Browser: Playwright or CDP. Desktop: debug
   protocol or accessibility tree. Mobile: the simulator. CLI/service: process,
   logs, API. If none exists, build a small one.
3. **Build the CLI.** At minimum `up` (scratch instance; record pid, URL, paths
   in a state file), `doctor` (read-only, actionable failures), `open <feature>`,
   `evidence`/`shot`, `down` (`--dry-run`). JSON with `--json`, rich `--help`,
   `--dry-run` on anything destructive, errors that name the fix.
4. **Feature map.** Reuse an existing machine-checked catalog by adding a
   "how to reach it as a user" field; otherwise `references/features/README.md`
   plus one file per feature: what, where, how to drive, gotchas.
5. **Write `verify-<app>/SKILL.md`.** When to use, launch, doctor, drive,
   evidence, cleanup, gotchas, safety — mostly commands, under 100 lines.
6. **Prove it.** up → doctor → drive two or three real features → evidence →
   down. Confirm nothing is left running and scratch data is gone.

## Maintain

Run only when the change touched launch/seed/login/teardown code, the
verification CLI, e2e fixtures it wraps, the feature catalog format, or a
feature's user path. If none applies, stop.

1. **Hygiene.** Every map entry resolves; no duplicates or stale features; new
   user-facing features from this change have an entry.
2. **Source wave (read-only).** Re-read the entry point and user path of each
   affected feature; note where map, CLI or skill text disagree with the code.
3. **Reconcile.** Update map, CLI and skill text to match the code.
4. **Live pass (required).** up → doctor → drive each affected feature →
   evidence → down. Static checks pass a wrong label; only this catches it.
5. **Triage.** Doc/map drift → fix. Harness gap → fix the CLI. Product
   regression → report with evidence, never weaken the check. Environment →
   retry once, then report.

## Safety

Credentials come from the environment or a secret manager; scratch copies are
mode 600 and deleted on `down`; never print tokens or authenticated URLs. Never
trigger native OS dialogs on the user's screen. One instance at a time under
load.

## Gotchas

- Register canonical paths (`realpath`); on macOS `/var/...` and `/private/var/...`
  are different to the app.
- Keep one browser process across CLI calls (pid in the state file); a new
  connection loses the page `open` reached.
- Wait for async UI with an `expect` before acting.
- Seed through the user path when shortcuts produce a different state.

## Outcome

End with exactly one: **Clean** (nothing drifted, live pass green), **Changed**
(what was fixed, one described revision, green live pass), or **Blocked** (what
failed, evidence paths, product regression vs environment).
