# Local Raycast extensions developed in this repo live under
# assets/raycast/<name>. Raycast imports them from a stable path so the
# registration survives clone moves: ~/RaycastExtensions/<name>. Source
# files sync incrementally; each extension's mutable node_modules stays put.
# NOTE: deliberately NOT ~/.config — Raycast rejects hidden folders as
# "Invalid development sources location" when importing.
# See assets/raycast/window-switcher/README.md for the import flow and the
# permissions the extension needs.
{ ... }:
let
  raycastAssets = ../assets/raycast;
in
{
  config.flake.modules.homeManager.raycastLocalExtensions =
    { pkgs, lib, ... }:
    let
      activationLib = import ../lib/activation.nix { inherit pkgs; };
    in
    lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      home.activation.raycastLocalExtensions = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        . ${activationLib}
        destination_base="$HOME/RaycastExtensions"
        for source in "${raycastAssets}"/*/; do
          [ -d "$source" ] || continue
          name="$(${pkgs.coreutils}/bin/basename "$source")"
          ${pkgs.coreutils}/bin/mkdir -p "$destination_base/$name"
          nixfiles_step raycastLocalExtensions "$name sync" 60s \
            ${pkgs.rsync}/bin/rsync -a --delete --exclude=node_modules \
            --chmod=Du+wx,Fu+rwX "$source" "$destination_base/$name/"
        done
      '';
    };
}
