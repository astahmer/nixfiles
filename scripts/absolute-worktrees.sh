set -euo pipefail

# Nix's libgit2 refuses to open a repository with extensions.relativeworktrees,
# and every colocated `jj workspace add` turns it on. Absolute worktree paths
# need no extension, so rewrite them before Nix fetches the flake.
flake="${NH_FLAKE:-}"
if [ -z "$flake" ] || ! common_dir="$(git -C "$flake" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
  exit 0
fi
if [ "$(git --git-dir="$common_dir" config --get extensions.relativeworktrees || true)" != true ]; then
  exit 0
fi

git --git-dir="$common_dir" worktree repair --no-relative-paths
git --git-dir="$common_dir" config --unset extensions.relativeworktrees
echo "nixfiles-absolute-worktrees: rewrote worktrees in $common_dir with absolute paths so Nix can read the flake"
