# `<name>-update`: creates or moves the checkout to the tracked revision (a
# dedicated jj workspace nobody edits), reinstalls its dependencies and
# refreshes the zsh completion. Extra settings: repo, track, launcher,
# completion_args (array), completion_dir.

if [ -n "$track" ]; then
  if [ ! -e "$checkout" ]; then
    if [ -z "$repo" ]; then
      echo "$name-update: $checkout does not exist and no repo is configured to create it from" >&2
      exit 1
    fi
    jj -R "$repo" git fetch
    jj -R "$repo" workspace add --name "$(basename "$checkout")" --revision "$track" "$checkout"
  else
    jj -R "$checkout" workspace update-stale >/dev/null
    jj -R "$checkout" git fetch
    if [ "$(jj -R "$checkout" log --no-graph -r @ -T 'empty')" != true ]; then
      echo "$name-update: $checkout has local changes; it follows $track and is not for editing" >&2
      echo "hint: move them to another workspace (jj -R $checkout log -r @), then run $name-update again" >&2
      exit 1
    fi
    if [ "$(jj -R "$checkout" log --no-graph -r '@-' -T 'commit_id')" != "$(jj -R "$checkout" log --no-graph -r "$track" -T 'commit_id')" ]; then
      jj -R "$checkout" new "$track"
    fi
  fi
fi

if [ ! -d "$checkout" ]; then
  echo "$name-update: no checkout at $checkout" >&2
  exit 1
fi

resolve_node
node_bin="$(dirname "$node")"
if [ -f "$checkout/pnpm-lock.yaml" ]; then
  (cd "$checkout" && PATH="$node_bin:$PATH" pnpm install --frozen-lockfile)
elif [ -f "$checkout/package-lock.json" ]; then
  (cd "$checkout" && PATH="$node_bin:$PATH" npm ci)
fi

if [ "${#completion_args[@]}" -gt 0 ]; then
  mkdir -p "$completion_dir"
  "$launcher" "${completion_args[@]}" >"$completion_dir/_$name.tmp"
  mv "$completion_dir/_$name.tmp" "$completion_dir/_$name"
fi

echo "$name now runs $checkout ($(jj -R "$checkout" log --no-graph -r '@-' -T 'commit_id.short() ++ " " ++ description.first_line()' 2>/dev/null || echo "not a jj workspace"))"
