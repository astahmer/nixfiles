set -euo pipefail

# Nix's libgit2 refuses to open a repository with extensions.relativeworktrees,
# and every colocated `jj workspace add` turns it on. Absolute worktree paths
# need no extension, so rewrite them before Nix reads the repository.
repos=("$@")
if [ "${#repos[@]}" -eq 0 ]; then
  if [ -n "${NH_FLAKE:-}" ]; then
    repos+=("$NH_FLAKE")
  fi
  repos+=("$PWD")
fi

for repo in "${repos[@]}"; do
  common_dir="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || continue
  if [ "$(git --git-dir="$common_dir" config --get extensions.relativeworktrees || true)" != true ]; then
    continue
  fi
  git --git-dir="$common_dir" worktree repair --no-relative-paths
  git --git-dir="$common_dir" config --unset extensions.relativeworktrees
  echo "nixfiles-absolute-worktrees: rewrote worktrees in $common_dir with absolute paths so Nix can read it"
done
