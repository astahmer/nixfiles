{ pkgs, lib, ... }:
{
  config.flake.modules.homeManager.tools =
    { ... }:
    lib.mkMerge [
      {
        programs.jjui.enable = true;
        programs.lazygit.enable = true;
        programs.lazydocker.enable = true;
      }

      (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        programs.zed-editor.enable = true;
      })
    ];
}