{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, lib, ... }:
    let
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };
      cameracontrollerModule = import ../macos/cameracontroller.nix { inherit pkgs lib; };
      kapModule = import ../macos/kap.nix { inherit pkgs lib; };
      cleanMyKeyboardId = "6468120888";
      mas = lib.getExe pkgs.mas;
      # huesyncModule = import ../macos/huesync.nix { inherit pkgs lib; };
    in
    {
      imports = [
        backgroundMusicModule
        cameracontrollerModule
        kapModule
        # huesyncModule
      ];

      home.activation.cleanMyKeyboard = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        installedApps="$("${mas}" list)"
        case "$installedApps" in
          *"${cleanMyKeyboardId}"*) ;;
          *)
            $DRY_RUN_CMD "${mas}" install ${cleanMyKeyboardId}
            ;;
        esac
      '';

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
