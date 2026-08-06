#!/usr/bin/env bash
set -euo pipefail

root="${1:-$PWD}"
if [ ! -f "$root/flake.nix" ]; then
  echo "nixfiles-check: no flake.nix found at $root" >&2
  exit 1
fi

cd "$root"

nix_files="$(git ls-files '*.nix')"
if [ -n "$nix_files" ]; then
  while IFS= read -r nix_file; do
    [ -n "$nix_file" ] || continue
    [ -f "$nix_file" ] || continue
    nixfmt --check "$nix_file"
    deadnix --fail "$nix_file"
  done <<< "$nix_files"
fi

git diff --check
if command -v swift >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  assets/bitwarden/test-secret.sh
  assets/bitwarden/test-completions.sh
  assets/bitwarden/test-shell.sh
  if [ -x assets/bitwarden/node_modules/.bin/tsc ]; then
    (cd assets/bitwarden && bun run typecheck)
  else
    echo "nixfiles-check: skipping secret typecheck (run 'bun install' in assets/bitwarden first)" >&2
  fi
elif command -v bun >/dev/null 2>&1; then
  SECRET_IMPL=ts assets/bitwarden/test-secret.sh
  assets/bitwarden/test-completions.sh
  assets/bitwarden/test-shell.sh
  if [ -x assets/bitwarden/node_modules/.bin/tsc ]; then
    (cd assets/bitwarden && bun run typecheck)
  else
    echo "nixfiles-check: skipping secret typecheck (run 'bun install' in assets/bitwarden first)" >&2
  fi
else
  echo "nixfiles-check: skipping secret regression tests (bun not on PATH)" >&2
fi
nix flake check --no-build "$root"
