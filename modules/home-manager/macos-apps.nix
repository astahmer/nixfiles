{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        orbstack
        slack
        shottr
      ];
    };
}