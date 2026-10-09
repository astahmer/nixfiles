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
