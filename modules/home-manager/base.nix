{ config, ... }:
{
  config.flake.modules.homeManager.base =
    { ... }:
    {
      home.stateVersion = config.flake.homeStateVersion;

      home.sessionVariables = {
        EDITOR = "nvim";
        VISUAL = "nvim";
      };

      programs.home-manager.enable = true;
      programs.zsh.enable = true;

      xdg.enable = true;
    };
}
