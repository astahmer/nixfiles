{ ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, lib, ... }:
    let
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };
      cameracontrollerModule = import ../macos/cameracontroller.nix { inherit pkgs lib; };
      cmdcmdModule = import ../macos/cmdcmd.nix { inherit pkgs lib; };
      kapModule = import ../macos/kap.nix { inherit pkgs lib; };
      cleanshotModule = import ../macos/cleanshot.nix { inherit pkgs lib; };
      caffeineModule = import ../macos/caffeine.nix { inherit pkgs lib; };
      cleanMyKeyboardId = "6468120888";
      mas = lib.getExe pkgs.mas;
      # huesyncModule = import ../macos/huesync.nix { inherit pkgs lib; };
    in
    {
      imports = [
        backgroundMusicModule
        cameracontrollerModule
        cmdcmdModule
        kapModule
        cleanshotModule
        caffeineModule
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

      home.activation.disableSpotlightHotkeys = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        hotkeysPlist="$HOME/Library/Preferences/com.apple.symbolichotkeys.plist"
        $DRY_RUN_CMD /usr/libexec/PlistBuddy -c "Set :AppleSymbolicHotKeys:64:enabled false" "$hotkeysPlist"
        $DRY_RUN_CMD /usr/libexec/PlistBuddy -c "Set :AppleSymbolicHotKeys:65:enabled false" "$hotkeysPlist"
        $DRY_RUN_CMD killall cfprefsd 2>/dev/null || true
        $DRY_RUN_CMD killall SystemUIServer 2>/dev/null || true
      '';

      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs."whatsapp-for-mac"
        pkgs.shottr
        pkgs.raycast
        pkgs.monitorcontrol
        pkgs.discord
        pkgs."alt-tab-macos"
        pkgs.orbstack
      ];
    };
}
