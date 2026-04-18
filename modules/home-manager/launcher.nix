{ ... }:
{
  config.flake.modules.homeManager.launcher =
    { ... }:
    {
      programs.vicinae = {
        enable = true;
        systemd.enable = true;
      };
    };
}
