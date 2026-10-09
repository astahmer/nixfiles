---
name: jj-history-consolidation
description: Collapse many stale, duplicated, or divergent jj revisions above a base revision into a single line of descendants without losing live work. Use when a repository above one revision has exploded into dozens of heads, when a previous unification attempt left duplicate branches, or for any history-shape request — "unify the history" into one branch, "spine branch", "linear history", "single line of descendants", "too many heads", "consolidate the history".
---

# Consolidate jj history into one line

Collapse everything above a base revision into one line of descendants.
Commands and recipes: [REFERENCE.md](REFERENCE.md).

## Sort the graph into three sets first

1. **Base** — the revision the user named.
2. **Live work** — descendants of the base that a live workspace `@` sits on:
   `<base>:: & (::<ws1>|::<ws2>|…)`.
3. **Junk** — every other descendant: `duplicate` copies, their rebased twins,
   abandoned variants.

Keep set 2, abandon set 3. Never linearize set 3.

## Rules

- Build with `jj duplicate -r <original-id> -o <tip>` per kept revision. The id
  is immutable, so nothing goes stale while the tip grows.
- Batch only a real parent-child run: `jj rebase -r 'a|b|c' -d <tip>`. An
  unrelated set becomes siblings, not a line.
- One unresolved conflict marks its whole subtree: find the **first** conflicted
  commit on the line, resolve it, re-scan, repeat.
- Union only when the two sides added distinct content. Two implementations of
  one change cannot share a line — pick a side or drop the duplicate.
- Abandon junk in one operation (`jj abandon '<base>:: & ~::<tip>'`), then sweep
  `jj workspace list`: re-created `@`s can land below the base.
- Verify: one head, zero conflicts, every workspace `@` on the line, then the
  repository's own gates (install, typecheck, build, test).

## Avoid

- **Linearizing stale duplicates.** Two variants of one change merge into
  non-overlapping hunks, so the files look resolved and are still broken.
- **Rebasing pre-captured commit ids.** Hole-filling rewrites descendants, so
  step 2's id is stale before you use it.
- **Trusting a conflict count.** It counts inherited conflicts, not locations.
- **Unioning a same-change conflict.** That is how Frankenstein files are born.
- **Writing files into a shared checkout whose `@` is mid-line.** Any write
  amends that revision and rebases every agent's subtree.
- **Bare `jj squash` / `jj describe`.** They open an editor and hang; pass `-m`
  or `--use-destination-message`.
- **`jj op restore` while other agents work.** It discards their operations too;
  revert only your own ops, newest first.
- **Calling it done from shape alone.** One head and zero conflicts can still
  join two versions of one function; run the gates.
- **Rewriting a revision another workspace holds as its `@`.** A concurrent
  snapshot turns it into a divergent copy of the same change (same change-id,
  second commit-id); name only revisions you created.
- **Splitting a many-change tip into nothing.** Record the tree-equality gate
  (`jj diff --from <old-tip> --to <new-tip>` = 0 files) before you claim a
  revision split preserved the content.

## Recovery

- `jj op revert <op-id>` undoes one operation; `jj op restore <op-id>` reverts
  everything after it.
- Abandoned revisions stay reachable from the operation log until GC.
