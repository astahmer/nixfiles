{ ... }:
{
  config.flake.modules.homeManager.tools =
    { lib, ... }:
    lib.mkMerge [
      {
        programs.jjui.enable = true;
        programs.lazygit.enable = true;
        programs.lazydocker.enable = true;
        programs.herdr.enable = true;
      }
    ];
}
