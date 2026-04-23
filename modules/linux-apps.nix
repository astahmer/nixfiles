{ config, ... }:
{
  config.flake.modules.homeManager.linuxApps =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs.discord
        pkgs."whatsapp-electron"
        pkgs.qdirstat
      ];
    };
}
