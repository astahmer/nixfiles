#!/usr/bin/env bash
set -euo pipefail

if ! command -v nixpkgs-lint &>/dev/null; then
  echo "nixpkgs-lint not found, attempting to run via nix..."
  nix run nixpkgs#nixpkgs-lint -- "$@"
  exit $?
fi

nixpkgs-lint "$@"
