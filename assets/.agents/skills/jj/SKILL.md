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
