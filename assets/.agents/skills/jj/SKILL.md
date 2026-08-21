---
name: jj
description: >
  Hard-won rules for safe jj history surgery in multi-workspace repos. Use before
  any abandon/rebase/op-restore/conflict-cleanup, or when divergent change-ids,
  hidden conflicted commits, or stale workspace working copies appear.
---

# JJ history surgery

## Never do this

- **Never target destructive ops by change-id.** Divergent change-ids auto-resolve
  to an arbitrary visible copy — you can kill your own ancestor while aiming at a
  duplicate. Always resolve to a **commit-id** first.
- **Never trust `(range) & conflict` as a cleanliness check.** It silently returns
  empty for hidden commits. Conflicted commits inside the ancestry will read as "0".
- **Never `jj restore --from <rev> <path>` blindly** — path args are fileset
  patterns; `$` in paths (e.g. `o.$orgSlug`) is a syntax error, and a failed
  lookup still truncates the redirect target to an empty file.

## Before restructuring history

1. Bookmark the op: note `jj op log -n 1` id. Rollback = `jj op restore <id>`
   (restores to the state *after* that op — not before it).
2. Complete/forget sibling workspaces; one writer per workspace. Commands in ws A
   rewrite ws B's working copy ("Concurrent modification detected").
3. Snapshot tree invariants: hash `jj diff --from <headA> --to <headB>` output;
   re-check after every batch.

## Conflict checks that actually work

Per-commit template scan over explicit ranges:

```bash
jj log -r '<range>' --no-graph -T 'if(conflict,"C",".\n")' | grep -c '^C$'
jj log -r '<range> & heads(all())' --no-graph -T 'if(conflict,"C ","") ++ description.first_line() ++ "\n"'
```

Hidden commits break revset algebra — enumerate by explicit id or range endpoints.

## Fixing conflicted commits (reliable recipe)

Oldest first — one deep fix often cascade-heals descendants:

```bash
jj new <conflicted-commit-id>        # by commit-id
# resolve markers (union both sides unless one side is strictly newer)
jj squash --into <commit-id> --use-destination-message
```

Re-scan after each; repeat until clean.

## Linearizing an N-parent merge

Keep one side as the spine; never hand-resolve inside the rewritten merge:

```bash
jj rebase -s <branchB-unique-start> -d <spine-tip>   # per parallel branch, oldest content first
jj rebase -s <post-merge-line> -d <new-tip>          # move descendants over
jj diff --from <new-tip> --to <original-merge-id> --stat   # MUST be empty before next step
jj abandon <original-merge-commit-id>
```

Keep the original merge commit-id as **golden reference**: resolve every cascade
conflict with `jj restore --from <golden> <paths>` + squash into the owning commit.
The empty-diff gate is mandatory — rebasing across reformatted regions can silently
drop whole blocks with zero conflict markers (only tree-equality detects it).

## Pruning strays safely

For each candidate commit-id: assert non-ancestry first, then abandon.

```bash
jj log -r "$cid & ::<head>" --no-graph    # empty = safe to abandon
jj abandon $cid
```

Expect abandoned-head cascades: each prune can expose parents. Iterate to fixpoint.

## Gotchas

- `jj op restore <op>` restores **to** that state, including its effects.
- Stale working copies after cross-workspace rewrites: re-materialize with
  `jj new <tip>` inside the affected workspace.
- `$`-paths: use git plumbing in colocated repos (`git show <rev>:<path>`), or
  escape filesets — don't pass bare paths to `jj file show`.
- Empty `wip` heads multiply from workspace churn; sweep with a fixpoint loop
  excluding only the live branch ancestry.
- Commit-ids go stale after every cascading rebase — fetch the target id
  immediately before each squash/abandon; squashing into a superseded copy is a
  silent no-op. Divergent change-ids also break revsets (`x & ::tip` errors);
  disambiguate with `change_id(x) & ::tip` first.
- Abandoning only a junk head exposes its parent as a new head — abandon the
  whole orphan chain (`::<junk-head> & ~::<fork-point>`, by explicit commit ids).
- `jj abandon` silently deletes bookmarks dangling on junk ("Deleted bookmarks:"
  line). Recover what they pointed at via `jj op show <abandon-op>`, re-point at
  the kept counterpart of the same change-id.
