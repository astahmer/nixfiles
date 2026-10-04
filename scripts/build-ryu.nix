# Helper for checking the jj-ryu release archive in isolation.
# Import the same package definition used by the flake output; this does not
# compile the upstream Rust workspace.
{
  system ? builtins.currentSystem,
}:
let
  pkgs = (builtins.getFlake (toString ../.)).inputs.nixpkgs.legacyPackages.${system};
in
import ../packages/ryu { inherit (pkgs) fetchurl lib stdenvNoCC; }
