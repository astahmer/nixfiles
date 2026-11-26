# Runs the live source entry of a local checkout: no build step, any cwd,
# arguments, stdin, exit code and signals pass through `exec`. Extra settings:
# entry, update_env, track_ref, repo_git, hint_stamp, git_bin.

script="$checkout/$entry"

if [ ! -f "$script" ]; then
  echo "$name: no $entry in $checkout" >&2
  echo "hint: run \`$name-update\` to create or refresh it, or point $checkout_env at another checkout" >&2
  exit 127
fi
if [ ! -d "$checkout/node_modules" ]; then
  echo "$name: dependencies are not installed in $checkout" >&2
  echo "hint: run \`$name-update\` (or pnpm install in $checkout)" >&2
  exit 1
fi
if [ "$checkout/pnpm-lock.yaml" -nt "$checkout/node_modules/.modules.yaml" ]; then
  echo "$name: pnpm-lock.yaml changed since the last install in $checkout; run \`$name-update\` if it fails" >&2
fi

# One dim line a day when the tracked ref (as last fetched, no network) is
# ahead of the checkout. Only file reads on the common path; `git rev-list`
# runs once per new tip. hint_stamp holds "<last print epoch> <tip seen not ahead>".
behind_hint() {
  local printed=0 quiet_tip="" tip="" head="" gitdir="$checkout/.git" line count
  if [ -z "$track_ref" ] || [ "$checkout" != "$default_checkout" ] || [ ! -t 2 ]; then return 0; fi
  if [ -r "$hint_stamp" ]; then read -r printed quiet_tip <"$hint_stamp" || true; fi
  if ((EPOCHSECONDS - printed < 86400)); then return 0; fi
  if [ -r "$repo_git/$track_ref" ]; then read -r tip <"$repo_git/$track_ref" || true; fi
  if [ -f "$gitdir" ]; then
    read -r line <"$gitdir" || true
    gitdir="${line#gitdir: }"
    case "$gitdir" in /*) ;; *) gitdir="$checkout/$gitdir" ;; esac
  fi
  if [ -r "$gitdir/HEAD" ]; then read -r head <"$gitdir/HEAD" || true; fi
  if [ -z "$tip" ] || [ -z "$head" ] || [ "$tip" = "$head" ] || [ "$tip" = "$quiet_tip" ]; then return 0; fi
  mkdir -p "$(dirname "$hint_stamp")"
  count="$("$git_bin" -C "$checkout" rev-list --count "$head..$tip" 2>/dev/null || echo 0)"
  if [ "$count" -eq 0 ]; then
    echo "$printed $tip" >"$hint_stamp"
    return 0
  fi
  printf '\033[2m%s: %s new commit(s) on %s; run %s-update\033[0m\n' "$name" "$count" "${track_ref#refs/remotes/}" "$name" >&2
  echo "$EPOCHSECONDS" >"$hint_stamp"
}

resolve_node
behind_hint

# The entry's own `#!/usr/bin/env -S node <flags>` shebang keeps its Node flags.
runtime_args=()
IFS= read -r shebang <"$script" || true
case "$shebang" in
  "#!/usr/bin/env -S node "*) read -r -a runtime_args <<<"${shebang#"#!/usr/bin/env -S node "}" ;;
esac

export "${update_env}=$name-update"
exec "$node" "${runtime_args[@]}" "$script" "$@"
