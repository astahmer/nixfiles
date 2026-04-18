{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.orbstack
        pkgs.slack
        pkgs.spotify
        pkgs.shottr
        pkgs."whatsapp-for-mac"
      ];
    };
}
