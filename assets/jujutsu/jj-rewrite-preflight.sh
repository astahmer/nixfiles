#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: jj-rewrite-preflight <target-revision>

Print a read-only report before rewriting JJ history. Prefer a full commit ID;
divergent or otherwise ambiguous revisions are listed and rejected.

The report uses --ignore-working-copy. Run `jj status` in each relevant
workspace first so the report includes the latest filesystem state.
EOF
}

if [[ $# -eq 1 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

jj_readonly() {
  jj --ignore-working-copy "$@"
}

if ! repository_root="$(jj_readonly root 2>/dev/null)"; then
  printf 'jj-rewrite-preflight: current directory is not in a JJ repository\n' >&2
  exit 2
fi

target="$1"
commit_template='commit_id ++ " change=" ++ change_id ++ " conflict=" ++ if(conflict, "yes", "no") ++ " " ++ description.first_line()'

printf 'Repository: %s\n' "$repository_root"
printf 'Read-only operation bookmark:\n'
jj_readonly op log -n 1

printf '\nRegistered workspaces:\n'
jj_readonly workspace list

if ! target_ids="$(jj_readonly log --no-graph -r "$target" -T 'commit_id')"; then
  printf '\njj-rewrite-preflight: could not resolve target: %s\n' "$target" >&2
  exit 2
fi

target_count="$(printf '%s\n' "$target_ids" | awk 'NF { count++ } END { print count + 0 }')"
if [[ "$target_count" -ne 1 ]]; then
  printf '\nTarget resolved to %s commits; choose one full commit ID:\n' "$target_count" >&2
  if [[ -n "$target_ids" ]]; then
    printf '%s\n' "$target_ids" >&2
  fi
  exit 2
fi

target_commit_id="$(printf '%s\n' "$target_ids" | awk 'NF { print; exit }')"
target_change_id="$(jj_readonly log --no-graph -r "$target_commit_id" -T 'change_id')"

printf '\nResolved target:\n'
jj_readonly log --no-graph -r "$target_commit_id" -T "$commit_template"

printf '\nCopies of target change ID:\n'
jj_readonly log --no-graph -r "change_id($target_change_id)" -T "$commit_template"

printf '\nVisible heads descended from any target copy:\n'
jj_readonly log --no-graph -r "change_id($target_change_id)::heads(all())" -T "$commit_template"

printf '\nMutable descendants of any target copy:\n'
jj_readonly log --no-graph -r "change_id($target_change_id):: & mutable()" -T "$commit_template"
