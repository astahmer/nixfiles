{ config, ... }:
{
  config.flake.modules.homeManager.linuxApps =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs."whatsapp-electron"
      ];
    };
}
