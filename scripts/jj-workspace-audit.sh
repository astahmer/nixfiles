#!/usr/bin/env bash
set -euo pipefail

scan_root="${JJ_WORKSPACE_ROOT:-$HOME/dev}"
older_than_days="${JJ_WORKSPACE_OLDER_THAN_DAYS:-30}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      [ "$#" -ge 2 ] || { echo "jj-workspace-audit: --root needs a path" >&2; exit 2; }
      scan_root="$2"
      shift 2
      ;;
    --older-than-days)
      [ "$#" -ge 2 ] || { echo "jj-workspace-audit: --older-than-days needs a number" >&2; exit 2; }
      older_than_days="$2"
      shift 2
      ;;
    -h|--help)
      printf '%s\n' \
        'Usage: jj-workspace-audit [--root PATH] [--older-than-days DAYS]' \
        '' \
        'Reports JJ workspaces without deleting or forgetting anything.'
      exit 0
      ;;
    *)
      echo "jj-workspace-audit: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[ -d "$scan_root" ] || { echo "jj-workspace-audit: root does not exist: $scan_root" >&2; exit 1; }

scan_root="$(cd "$scan_root" && pwd)"
now_epoch="$(date +%s)"
repo_candidates="$(mktemp -t jj-workspace-audit-repos.XXXXXX)"
rows="$(mktemp -t jj-workspace-audit-rows.XXXXXX)"
git_candidates="$(mktemp -t jj-workspace-audit-git.XXXXXX)"
trap 'rm -f "$repo_candidates" "$rows" "$git_candidates"' EXIT

date_epoch() {
  local date_value="$1"
  date -j -f '%Y-%m-%d' "$date_value" '+%s' 2>/dev/null || date -d "$date_value" '+%s' 2>/dev/null
}

workspace_state() {
  local status_output
  status_output="$(jj -R "$1" status 2>&1 || true)"
  case "$status_output" in
    *'The working copy has no changes.'*) printf 'clean' ;;
    *'Working copy changes:'*) printf 'dirty' ;;
    *) printf 'unknown' ;;
  esac
}

while IFS= read -r -d '' jj_dir; do
  repo_marker="$jj_dir/repo"
  if [ -f "$repo_marker" ]; then
    repo_target="$(cat "$repo_marker")"
    repo_ref="$(cd "$jj_dir" && cd "$(dirname "$repo_target")" && pwd)/$(basename "$repo_target")"
  elif [ -d "$repo_marker" ]; then
    repo_ref="$(cd "$repo_marker" && pwd)"
  else
    continue
  fi
  printf '%s\t%s\n' "$repo_ref" "${jj_dir%/.jj}" >> "$repo_candidates"
done < <(find "$scan_root" -mindepth 2 -maxdepth 2 -type d -name .jj -print0)

while IFS=$'\t' read -r repo_ref workspace_root; do
  [ -n "$repo_ref" ] || continue
  repo_root="$(dirname "$(dirname "$repo_ref")")"

  while IFS= read -r workspace_line; do
    [ -n "$workspace_line" ] || continue
    workspace_name="${workspace_line%%:*}"
    details="${workspace_line#*: }"
    workspace_relative_path="${details%% *}"
    details="${details#* }"
    details="${details#* }"
    commit_id="${details%% *}"
    workspace_path="$(cd "$workspace_root/$workspace_relative_path" 2>/dev/null && pwd || true)"
    [ -n "$workspace_path" ] || continue

    metadata="$(jj --ignore-working-copy -R "$repo_root" log --no-graph -r "$commit_id" -n 1 -T 'committer.timestamp() ++ "\n"' 2>/dev/null || true)"
    change_date="${metadata:0:10}"
    [ "${#change_date}" -eq 10 ] || change_date='?'
    age_days='?'
    if [ "$change_date" != '?' ]; then
      change_epoch="$(date_epoch "$change_date" || true)"
      [ -n "$change_epoch" ] && age_days="$(( (now_epoch - change_epoch) / 86400 ))"
    fi

    state="$(workspace_state "$workspace_path")"
    if [ "$workspace_path" = "$repo_root" ]; then
      action='protected-root'
    elif [ "$state" != 'clean' ]; then
      action="protected-$state"
    elif [ "$age_days" != '?' ] && [ "$age_days" -ge "$older_than_days" ]; then
      action='review'
    else
      action='recent'
    fi

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$workspace_name" "$repo_root" "$workspace_path" "$commit_id" "$change_date" "$age_days" "$state" "$action" >> "$rows"
  done < <(jj --ignore-working-copy -R "$workspace_root" workspace list 2>/dev/null || true)
done < <(awk -F '\t' '!seen[$1]++' "$repo_candidates")

while IFS= read -r -d '' git_dir; do
  repo_root="${git_dir%/.git}"
  git -C "$repo_root" worktree list --porcelain 2>/dev/null | awk -v root="$repo_root" '
    /^worktree / { path = substr($0, 10) }
    /^HEAD / { head = substr($0, 6) }
    /^$/ {
      if (path != "") printf "%s\t%s\t%s\n", root, path, head
      path = ""
      head = ""
    }
    END {
      if (path != "") printf "%s\t%s\t%s\n", root, path, head
    }
  '
done < <(find "$scan_root" -mindepth 2 -maxdepth 2 -type d -name .git -print0) | sort -u > "$git_candidates"

while IFS=$'\t' read -r repo_root workspace_path commit_id; do
  [ -n "$workspace_path" ] || continue
  workspace_path="$(cd "$workspace_path" 2>/dev/null && pwd || true)"
  [ -n "$workspace_path" ] || continue

  change_date="$(git -C "$workspace_path" show -s --format='%cs' HEAD 2>/dev/null || true)"
  [ -n "$change_date" ] || change_date='?'
  state='clean'
  [ -z "$(git -C "$workspace_path" status --porcelain --untracked-files=no 2>/dev/null || true)" ] || state='dirty'
  age_days='?'
  if [ "$change_date" != '?' ]; then
    change_epoch="$(date_epoch "$change_date" || true)"
    [ -n "$change_epoch" ] && age_days="$(( (now_epoch - change_epoch) / 86400 ))"
  fi

  if [ "$workspace_path" = "$repo_root" ]; then
    action='protected-root'
  elif [ "$state" != 'clean' ]; then
    action="protected-$state"
  elif [ "$age_days" != '?' ] && [ "$age_days" -ge "$older_than_days" ]; then
    action='review'
  else
    action='recent'
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    git-worktree "$repo_root" "$workspace_path" "${commit_id:0:8}" "$change_date" "$age_days" "$state" "$action" >> "$rows"
done < "$git_candidates"

printf 'name\trepository\tpath\tcommit\tlast_change\tage_days\tstate\taction\n'
sort -u "$rows"
