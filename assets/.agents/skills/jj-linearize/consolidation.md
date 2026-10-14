# Consolidation recipes (folded in from the retired jj-history-consolidation skill)

Use this when the graph above a base has exploded into dozens of heads, when a previous
unification left duplicate branches, or when live agents keep committing while you fold.

## Procedure

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
- Snapshot every workspace before the first rewrite (`jj status` inside each);
  edits that were never snapshotted are not in the store.
- Move an interior workspace `@` with `jj new <tip>` **inside that workspace**,
  never `jj rebase -r`: moving an interior revision re-applies every commit above
  it and re-introduces conflicts you already resolved.
- Re-fold after every pass. A rewrite orphans each live `@` that was a child of
  the tip: `jj rebase -r <stray-head> -d <tip>`, then abandon the duplicate copy.
  Live agents keep committing, so expect to repeat this until they stop.
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
- **`jj op revert` on an op you already reverted.** Reverting a revert re-applies
  it, and a long chain drifts. One op per call, newest first; for a window you own,
  one `jj op restore <good-op>`.
- **Describing an interior revision without re-folding.** It rewrites the whole
  subtree above it and orphans every live `@` that hung off the tip.
- **Moving the base bookmark onto the tip.** Tools that treat it as the base —
  `main::` revsets, a cache keyed on `jj diff --from main` — go silently empty.
  Key content caches on the tree, not on a bookmark.

## Recovery

- `jj op revert <op-id>` undoes one operation; `jj op restore <op-id>` reverts
  everything after it.
- Abandoned revisions stay reachable from the operation log until GC.

## Recipes

# Consolidation recipes

Every command below was used on a real 125-revision consolidation; paths and ids
are placeholders.

## 1. Inventory

```bash
BASE=xspqskqt/0
# live work: descendants of the base that a live workspace still sits on
WS=$(jj workspace list | awk -F'[ :]+' '{print "::"$4}' | paste -sd'|' -)
jj log -r "$BASE:: & ($WS)" --no-graph -T 'commit_id ++ "\n"' | wc -l   # keep
jj log -r "$BASE:: & ~($WS)" --no-graph -T 'commit_id ++ "\n"' | wc -l  # junk
jj log -r "heads($BASE::)" --no-graph -T 'commit_id ++ "\n"' | wc -l
```

Distinct work, not distinct commits, is what you are keeping. Group by a
rebase-invariant patch signature (added/removed lines only, strip hunk headers)
to see how many real changes hide behind the head count:

```bash
jj diff -r <commit> --git --no-pager \
  | grep -E '^(diff --git|[+-])' | grep -vE '^(\+\+\+|---) ' | shasum
```

Two commits with the same description and overlapping line sets are variants of
one change; keep one.

## 2. Rebuild loop (race-proof)

```bash
tip=<base-or-trunk-tip>
for node in $(cat order.txt); do          # order: DFS preorder over the live DAG
  before=$(jj log -r "children($tip)" --no-graph -T 'commit_id ++ "\n"')
  jj duplicate -r "$node" -o "$tip"       # node = original, immutable commit id
  after=$(jj log -r "children($tip)" --no-graph -T 'commit_id ++ "\n"')
  tip=$(comm -13 <(echo "$before" | sort) <(echo "$after" | sort))   # the one new child
  jj log -r "$tip" --no-graph -T 'if(conflict,"C","-")'              # abort/skip on C
done
```

- Resolve the new tip by child-set difference, never by assuming the last id in
  a batch: the first tip in a repository already has dozens of children.
- Keep a JSON state file with `{tip, index}` so a crash or a usage limit can
  resume without duplicating work.
- DFS preorder over the real DAG keeps a feature's revisions adjacent and gives
  ancestry-correct ordering for free.

## 3. Root-conflict scan

```bash
TIP=<line-tip>
jj log -r "$BASE:: & ::$TIP" --no-graph \
  -T 'commit_id ++ "\t" ++ if(conflict,"C","-") ++ "\t" ++ description.first_line() ++ "\n"' \
  > /tmp/line.tsv
# reverse the file (newest first) and print the first C per contiguous run
awk -F'\t' 'prev!="C" && $2=="C" {print $1, $3} {prev=$2}' /tmp/line.tsv
```

Resolve the root, re-run the scan; each resolution rewrites descendants and can
surface a new root.

```bash
jj resolve -r <root> --list                       # conflicted paths
jj resolve -r <root> --tool :ours                 # or :theirs (side #1 / side #2)
```

Manual merge (union, or a hybrid of both sides): do it in a scratch workspace,
never in the checkout that is mid-line.

```bash
jj workspace add /tmp/jjfix --name jjfix
cd /tmp/jjfix
jj new <root>            # @ becomes a child; the conflict is materialised
# edit the files, delete the marker lines
jj squash --use-destination-message   # --use-destination-message avoids the editor
```

`jj resolve -r` on a non-`@` revision rewrites that revision; the bookmark
follows. Check which side keeps the tree coherent — grep the tree for the
identifier each side introduces before choosing.

## 4. Abandonment and workspace sweep

```bash
jj abandon "$BASE:: & ~::$TIP"        # one op; prints Deleted bookmarks
jj abandon '<divergent-copy>::'       # e.g. a second copy of the base change
jj bookmark create <name> -r "$TIP"   # re-create anything the abandon deleted
jj workspace list                     # re-created @s may sit below BASE
jj rebase -r <stray-ws-@> -d "$TIP"   # put them back on the line
```

Abandoning a workspace's `@` gives that workspace a fresh empty commit on the
nearest **visible** ancestor. If the whole branch was abandoned, that ancestor
can be below the base revision, so the sweep is mandatory, not cosmetic.

## 5. Verification

```bash
jj log -r "heads($BASE::)" --no-graph -T 'commit_id ++ "\n"' | wc -l   # 1
jj log -r 'conflicts()'    --no-graph -T 'commit_id ++ "\n"' | wc -l   # 0
```

Then run the repository's own gates on the merged tree (install, typecheck,
build, test). Split baseline drift from merge damage by intersecting failing
paths with the merge footprint:

```bash
jj diff --from <pre-merge-revision> --to @ --summary > /tmp/footprint.txt
# any failing path absent from footprint.txt is pre-existing
```

A merged tree usually needs wiring fixes the history work exposes: regenerated
lockfiles, a local-link vs published-package override, or a package script the
workspace contract requires. Those belong in the same closeout commit.

## Trap table

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Revision <id> doesn't exist` / divergent copies after a scripted rebase | planned id went stale because earlier steps hole-filled descendants | resolve by change-id at use time, or duplicate by immutable id |
| `cannot resolve new tip` right after a rebase | tip resolution assumed one child, or the set had no internal edges | diff `children(<tip>)` before/after |
| `jj squash` hangs for minutes | it opened an editor | add `-m` or `--use-destination-message` |
| conflict count jumps from 1 to hundreds | one root conflict is inherited by every descendant | scan for the first conflicted commit on the line |
| every descendant of a moved commit conflicts | two variants of one change were both linearized | dedupe by description/content instead of merging |
| `jj file show` says "exists but is not a file" | path is a symlink or gitlink in the tree | `git ls-tree <rev> <dir>` (120000 symlink, 160000 submodule) |
| stale workspace error when rebasing another workspace's work | jj refuses to move foreign `@`s in some flows | `jj duplicate` the commit and rebase the copy |
| workspace `@` lands below the base after abandonment | fresh `@` created on nearest visible ancestor | sweep `jj workspace list` and rebase strays onto the tip |
| a pass leaves dozens of new heads | live `@`s were children of the rewritten tip | `jj rebase -r <head> -d <tip>` each stray, abandon the duplicate copies |
| `jj op revert` appears to do nothing, or re-applies the damage | the op was already reverted once | stop chaining; read `jj op log`, then one `jj op restore <good-op>` |
| scripts fail with `Name <bookmark> is conflicted` | a conflicted bookmark cannot be used as a revset name | `jj bookmark set <name> -r <rev> --allow-backwards` first |
| a content cache always reports "carried over" | its base bookmark now points at the tip, so the diff is empty | key the cache on the tree (`jj diff --from root() --to <rev>`), not a bookmark |
| a rebase of an interior marker re-conflicts resolved commits | descendants were re-applied onto the marker's old parent | move interior workspace `@`s with `jj new <tip>` inside the workspace |
| the same change-id appears twice, a second head, a `@` off the line | two writers raced; jj reconciled divergent operations by keeping both results | keep the copy a live workspace holds, `jj rebase -r <stray-head> -d <tip>`, abandon the twin; re-scan after every pass |

## 6. Rebased twins and conflict-artifact copies

A store that survived several rewrites often holds two copies of one change: one
clean, one whose tree carries `.jjconflict-*` materialised side files.

```bash
for c in $(jj log -r "<range>" --no-graph -T 'commit_id ++ "\n"'); do
  echo "$c sidefiles=$(git ls-tree -r --name-only "$c" | grep -c '^\.jjconflict-')"
done
jj log -r '<range>' --no-graph -T 'change_id ++ "\n"' | sort | uniq -d   # twins
```

- Keep the copy with zero side files; it is the resolved tree.
- `jj rebase` drops inherited side files — they cancel in the change diff — while a
  git patch of the same commit re-adds them. Rebase, do not cherry-pick patches.
- To prove a prune changed no tree, read the pre-op tip with `jj --at-op <op-id>`
  and compare: `git diff <old-tip> <new-tip>` must be 0 files. Compare the right
  pair: other agents editing the shared checkout change the tree too.

