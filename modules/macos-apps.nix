{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, lib, ... }:
    let
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };
    in
    {
      imports = [
        backgroundMusicModule
      ];

      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs."whatsapp-for-mac"
        pkgs.shottr
        pkgs.raycast
        pkgs.caffeine
        pkgs.monitorcontrol
        pkgs.discord
      ];
    };
}
