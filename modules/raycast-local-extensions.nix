# Local Raycast extensions developed in this repo live under
# assets/raycast/<name>. Raycast imports them from a stable path so the
# registration survives clone moves: ~/.config/raycast-extensions/<name>
# is seeded as a WRITABLE copy on every activation (Raycast needs to run
# npm/pnpm install inside it), with node_modules preserved across reseeds.
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
        dst_base="$HOME/.config/raycast-extensions"
        mkdir -p "$dst_base"
        for src in "$src_base"/*/; do
          name="$(basename "$src")"
          dst="$dst_base/$name"
          tmp="$dst_base/.tmp-$name"
          keep="$dst_base/.keep-node_modules-$name"
          if [ -d "$dst/node_modules" ]; then mv "$dst/node_modules" "$keep"; fi
          rm -rf "$dst" "$tmp"
          mkdir -p "$dst"
          cp -R "$src"/. "$dst"/
          if [ -d "$keep" ]; then mv "$keep" "$dst/node_modules"; fi
        done
      '';
    in
    lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      home.activation.raycastLocalExtensions = lib.hm.dag.entryAfter [ "writeBoundary" ] "${seedScript}";
    };
}
