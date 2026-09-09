set -euo pipefail

flake="${NH_FLAKE:-}"
if [ -z "$flake" ] || [ ! -f "$flake/flake.nix" ]; then
  echo "nixfiles-update-all: NH_FLAKE is missing or does not point to a flake" >&2
  echo "  Set NH_FLAKE to the nixfiles checkout, or run nixfiles-here first" >&2
  exit 1
fi

echo "Updating all registered flake inputs and routine package pins..."
nix run "$flake#update-pins" -- --validate fast

echo "Applying the updated macOS Home Manager profile..."
nh home switch -c macbook -b hm-backup
