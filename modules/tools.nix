{ ... }:
{
  config.flake.modules.homeManager.tools =
    { pkgs, lib, ... }:
    lib.mkMerge [
      {
        programs.jjui.enable = true;
        programs.lazygit.enable = true;
        programs.lazydocker.enable = true;
      }
    ];
}
