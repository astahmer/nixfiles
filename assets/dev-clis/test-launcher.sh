#!/usr/bin/env bash
# Runs the dev CLI launcher against a fake checkout and a fake fnm tree.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fake_node() {
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/sh\necho "%s $*"\n' "$2" >"$1"
  chmod +x "$1"
}
fake_node "$tmp/fnm/node-versions/v24.1.2/installation/bin/node" fnm-node
fake_node "$tmp/nix/bin/node" nix-node

checkout="$tmp/checkout"
mkdir -p "$checkout/src" "$checkout/node_modules"
printf '#!/usr/bin/env -S node --max-semi-space-size=2\n' >"$checkout/src/main.ts"
echo "v24.1.2" >"$checkout/.node-version"

launcher="$tmp/demo"
{
  echo '#!/usr/bin/env bash'
  echo 'set -euo pipefail'
  echo "name=demo default_checkout='$checkout' entry=src/main.ts checkout_env=DEMO_CHECKOUT update_env=DEMO_UPDATE_COMMAND"
  echo "fallback_node='$tmp/nix/bin/node' fallback_node_major=24"
  echo "track_ref=refs/remotes/origin/main repo_git='$checkout/.git' hint_stamp='$tmp/state/demo.behind' git_bin=git"
  echo "bundle_entry=dist/demo.mjs bundle_stamp=dist/.source-commit source_env=DEMO_SOURCE"
  cat "$here/common.sh" "$here/launcher.sh"
} >"$launcher"
chmod +x "$launcher"

fail() {
  echo "test-launcher: $1" >&2
  exit 1
}
expect() {
  local label="$1" want="$2" got="$3"
  [ "$got" = "$want" ] || fail "$label: expected '$want', got '$got'"
}

export FNM_DIR="$tmp/fnm"
cd /
expect "exact fnm version with shebang flags" \
  "fnm-node --max-semi-space-size=2 $checkout/src/main.ts a b c" "$("$launcher" a 'b c')"

# Bundle selection: a jj workspace's `.git` file points at a worktree gitdir
# whose detached HEAD is @-; a branch HEAD resolves through commondir.
sha_a=1111111111111111111111111111111111111111
sha_b=2222222222222222222222222222222222222222
mkdir -p "$checkout/dist" "$tmp/repo/.git/worktrees/checkout" "$tmp/repo/.git/refs/heads"
printf '#!/usr/bin/env -S node --enable-source-maps\n' >"$checkout/dist/demo.mjs"
echo "gitdir: ../repo/.git/worktrees/checkout" >"$checkout/.git"
echo "$sha_a" >"$tmp/repo/.git/worktrees/checkout/HEAD"
echo "../.." >"$tmp/repo/.git/worktrees/checkout/commondir"
bundle_run="fnm-node --enable-source-maps $checkout/dist/demo.mjs x"
source_run="fnm-node --max-semi-space-size=2 $checkout/src/main.ts x"
expect "no stamp runs the source" "$source_run" "$("$launcher" x)"
echo "$sha_a" >"$checkout/dist/.source-commit"
expect "stamp equal to the worktree HEAD runs the bundle" "$bundle_run" "$("$launcher" x)"
expect "DEMO_SOURCE forces the source" "$source_run" "$(DEMO_SOURCE=1 "$launcher" x)"
[[ "$(DEV_CLIS_DEBUG=1 "$launcher" x 2>&1 >/dev/null)" == "demo: running $checkout/dist/demo.mjs" ]] || fail "debug line missing"
cp -R "$checkout" "$tmp/copy"
echo "gitdir: $tmp/repo/.git/worktrees/checkout" >"$tmp/copy/.git"
expect "a checkout override runs its source" \
  "fnm-node --max-semi-space-size=2 $tmp/copy/src/main.ts x" "$(DEMO_CHECKOUT="$tmp/copy" "$launcher" x)"
rm -rf "$tmp/copy"
echo "$sha_b" >"$tmp/repo/.git/worktrees/checkout/HEAD"
expect "a newer commit than the stamp runs the source" "$source_run" "$("$launcher" x)"
echo "ref: refs/heads/main" >"$tmp/repo/.git/worktrees/checkout/HEAD"
echo "$sha_a" >"$tmp/repo/.git/refs/heads/main"
expect "a branch HEAD resolves through commondir" "$bundle_run" "$("$launcher" x)"
rm "$checkout/dist/demo.mjs"
expect "a stamp without its bundle runs the source" "$source_run" "$("$launcher" x)"
rm -rf "$checkout/dist" "$checkout/.git" "$tmp/repo"

# The behind hint needs a terminal on stderr; macOS `script` provides one.
if [ "$(uname)" = Darwin ]; then
  git_quiet() { git -C "$checkout" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "$@" >/dev/null; }
  git_quiet init -q
  git_quiet commit -q --allow-empty -m one
  old="$(git -C "$checkout" rev-parse HEAD)"
  git_quiet commit -q --allow-empty -m two
  git_quiet commit -q --allow-empty -m three
  mkdir -p "$checkout/.git/refs/remotes/origin"
  git -C "$checkout" rev-parse HEAD >"$checkout/.git/refs/remotes/origin/main"
  echo "$old" >"$checkout/.git/HEAD"
  in_tty() { script -q /dev/null "$launcher" 2>&1 | tr -d '\r'; }
  [[ "$(in_tty)" == *"demo: 2 new commit(s) on origin/main; run demo-update"* ]] || fail "behind hint missing"
  [[ "$(in_tty)" != *"new commit"* ]] || fail "behind hint repeated within a day"
  [[ "$("$launcher" 2>&1)" != *"new commit"* ]] || fail "behind hint without a terminal"
  rm "$tmp/state/demo.behind"
  cp "$checkout/.git/refs/remotes/origin/main" "$checkout/.git/HEAD"
  [[ "$(in_tty)" != *"new commit"* ]] || fail "behind hint when up to date"
  rm -rf "$checkout/.git"
fi

echo "24" >"$checkout/.node-version"
expect "partial version falls back to the pinned major" \
  "nix-node --max-semi-space-size=2 $checkout/src/main.ts" "$("$launcher")"

echo "22.0.0" >"$checkout/.node-version"
if out="$("$launcher" 2>&1)"; then fail "other major must fail"; fi
[[ "$out" == *"fnm install 22.0.0"* ]] || fail "missing fnm hint: $out"

rm "$checkout/.node-version"
rm -r "$checkout/node_modules"
if out="$("$launcher" 2>&1)"; then fail "missing deps must fail"; fi
[[ "$out" == *"run \`demo-update\`"* ]] || fail "missing deps hint: $out"

set +e
DEMO_CHECKOUT="$tmp/elsewhere" "$launcher" >/dev/null 2>&1
code=$?
set -e
expect "checkout override missing exits 127" 127 "$code"

echo "test-launcher: ok"
