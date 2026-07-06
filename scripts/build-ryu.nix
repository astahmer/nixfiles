# Helper for bumping jj-ryu hashes.
# Import the same package definition used by the flake module and build it in isolation.
{ system ? builtins.currentSystem }:
let
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz";
  }) { inherit system; };
in
import ../packages/ryu.nix { inherit pkgs; }