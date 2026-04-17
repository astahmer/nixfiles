{ config, lib, ... }:
{
  config.flake.modules.homeManager.git =
    { ... }:
    {
      programs.git = {
        enable = true;
        settings = {
          user.name = lib.mkDefault config.home.username;
          init.defaultBranch = lib.mkDefault "main";
          push.autoSetupRemote = lib.mkDefault true;
        };
      };
    };
}
