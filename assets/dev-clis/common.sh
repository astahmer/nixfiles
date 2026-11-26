# Shared by the dev CLI launcher and its `<name>-update`; modules/dev-clis.nix
# prepends the per-CLI settings (name, default_checkout, checkout_env,
# fallback_node, fallback_node_major).

checkout="${!checkout_env:-$default_checkout}"

# Node from the checkout's .node-version through fnm's install tree (no fnm
# process per call); the pinned Nix Node covers a missing fnm install of the
# same major, anything else asks for the exact install.
resolve_node() {
  local want="" file candidate
  for file in .node-version .nvmrc; do
    if [ -r "$checkout/$file" ]; then
      IFS= read -r want <"$checkout/$file" || true
      break
    fi
  done
  want="${want//[[:space:]]/}"
  want="${want#v}"
  if [ -z "$want" ]; then
    node="$fallback_node"
    return
  fi
  candidate="${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}/node-versions/v$want/installation/bin/node"
  if [ -x "$candidate" ]; then
    node="$candidate"
    return
  fi
  if [ "${want%%.*}" = "$fallback_node_major" ]; then
    node="$fallback_node"
    return
  fi
  echo "$name: Node $want (from $checkout) is not installed" >&2
  echo "hint: fnm install $want" >&2
  exit 1
}
