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
      seedScript = pkgs.writeShellScript "seed-raycast-extensions" ''
        set -eu
        src_base="${raycastAssets}"
        dst_base="$HOME/RaycastExtensions"
        ${pkgs.coreutils}/bin/mkdir -p "$dst_base"
        for src in "$src_base"/*/; do
          [ -d "$src" ] || continue
          name="$(basename "$src")"
          dst="$dst_base/$name"
          ${pkgs.coreutils}/bin/mkdir -p "$dst"
          started="$SECONDS"
          printf '[nixfiles:raycastLocalExtensions] %s sync started\n' "$name" >&2
          if ${pkgs.coreutils}/bin/timeout --kill-after=5s 60s \
            ${pkgs.rsync}/bin/rsync -a --delete --exclude=node_modules \
              --chmod=Du+wx,Fu+rwX "$src" "$dst/"; then
            elapsed=$((SECONDS - started))
            printf '[nixfiles:raycastLocalExtensions] %s sync completed in %ss\n' "$name" "$elapsed" >&2
          else
            status="$?"
            elapsed=$((SECONDS - started))
            printf '[nixfiles:raycastLocalExtensions] %s sync failed after %ss (status %s)\n' "$name" "$elapsed" "$status" >&2
            exit "$status"
          fi
        done
      '';
    in
    lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      home.activation.raycastLocalExtensions = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        ${pkgs.coreutils}/bin/timeout --kill-after=5s 180s "${seedScript}"
      '';
    };
}
