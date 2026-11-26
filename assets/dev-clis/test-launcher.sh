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
