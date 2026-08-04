# Helper for checking the jj-ryu release archive in isolation.
# Import the same package definition used by the flake output; this does not
# compile the upstream Rust workspace.
{
  system ? builtins.currentSystem,
}:
let
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz";
  }) { inherit system; };
in
import ../packages/ryu { inherit pkgs; }
