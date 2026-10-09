---
name: jj-history-consolidation
description: Collapse many stale, duplicated, or divergent jj revisions above a base revision into a single line of descendants without losing live work. Use when a repository above one revision has exploded into dozens of heads, when a previous unification attempt left duplicate branches, or when the user asks to "unify the history" into one branch.
---

# Consolidate jj history into one line

Use when everything above a chosen base revision must become a single line of
descendants. The repository is usually shared: other agents keep writing while
you rewrite. Read [REFERENCE.md](REFERENCE.md) for the executable recipes
(canonical-set revsets, the duplicate-based rebuild loop, root-conflict scans,
abandonment, and the verification gates).

## Model the three sets before touching anything

1. **Base** — the revision the user named. `main` stays on it.
2. **Live work** — descendants of the base that are ancestors of a live
   workspace working-copy commit:
   `jj log -r '<base>:: & (::<ws1>|::<ws2>|…)'`.
3. **Junk** — every other descendant. Most heads in an exploded repository are
   here: copies from `jj duplicate`, their rebased twins, and stale variants.

Never linearize set 3. A previous attempt usually created it; merging it back
in produces Frankenstein files (both variants of a function survive in
non-overlapping hunks) even when every conflict is "resolved".

## Rebuild, do not rebase a plan

A rebase rewrites the target's descendants
(`Rebased N descendant commits onto updated working copy`), so any commit id you
captured for a later step is stale before you use it. Two safe patterns:

- `jj duplicate -r <original-commit-id> -o <tip>` per kept revision. The id is
  immutable, so hole-filling and concurrent rewrites cannot invalidate it. The
  original stays put and is abandoned at the end.
- Or resolve each planned revision by change-id immediately before using it
  (change-ids survive rewrites; commit ids do not).

Batch only a genuine parent-child run in one op: `jj rebase -r 'a|b|c' -d <tip>`
preserves the edges inside the set. A set without edges becomes siblings, not a
line.

## Conflicts: find the root, then decide variant vs feature

One unresolved conflict marks the commit and every descendant, so a count is
not a location. Walk the line from the base and take the **first** conflicted
commit; that is the root. Resolve it, re-scan, repeat.

- Different features adding distinct content (scenarios, list entries, docs) →
  union both sides.
- Same feature, two implementations (same description or same touched files) →
  the line cannot hold both coherently. Pick one side with
  `jj resolve -r <rev> --tool :ours|:theirs`, or skip the duplicate entirely.
- Never `jj squash` or `jj describe` without `-m` /
  `--use-destination-message` from an agent shell: both open an editor and hang.

## Keep the checkout out of the surgery

While the shared checkout's `@` sits mid-line, writing any file into it amends
that commit and rebases the whole subtree under you. Do file work in a
throwaway `jj workspace add` instead, or move `@` to the tip first.

## Finish and verify

- Abandon the rest in one op: `jj abandon '<base>:: & ~::<tip>'`. Expect it to
  delete bookmarks that pointed into the junk (`Deleted bookmarks:`) and to
  re-create abandoned workspace `@`s on the nearest visible ancestor — which can
  land **below** the base, so sweep the workspace list afterwards and put every
  `@` back on the line.
- Re-create the bookmark you want on the tip (`jj bookmark create <name> -r <tip>`).
- Verify: `heads(<base>::)` = 1, `conflicts()` = 0, every workspace `@`
  reachable from the tip, then install/typecheck/build/test.
- Separate baseline failures from merge regressions by intersecting the failing
  paths with the merge footprint (`jj diff --from <pre-merge> --to @ --summary`).
  Failures outside that footprint are pre-existing drift.

## Recovery

- `jj op revert <op-id>` undoes exactly one operation; use it to back out only
  your own steps in a shared store.
- `jj op restore <op-id>` reverts everything after that operation, including
  other agents' work — reserve it for a full rollback.
- Abandoned revisions stay reachable from the operation log until GC.
