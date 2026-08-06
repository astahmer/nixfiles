{ inputs, ... }:
{
  config.flake.modules.homeManager.macosApps =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      codexbar = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.codexbar;
      crisp = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.crisp;
      ice = pkgs."ice-bar";
      secretbar = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secretbar;
      tidyports = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.tidyports;
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
        if installedApps="$("${mas}" list 2>/dev/null)"; then
          case "$installedApps" in
            *"${cleanMyKeyboardId}"*) ;;
            *)
              $DRY_RUN_CMD "${mas}" install ${cleanMyKeyboardId}
              ;;
          esac
        else
          echo "warning: could not inspect the Mac App Store; skipping CleanMyKeyboard" >&2
        fi
      '';

      home.activation.disableSpotlightHotkeys = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        hotkeysPlist="$HOME/Library/Preferences/com.apple.symbolichotkeys.plist"
        hotkeysChanged=0
        if [ -f "$hotkeysPlist" ]; then
          for hotkey in 64 65; do
            enabled="$(/usr/libexec/PlistBuddy -c "Print :AppleSymbolicHotKeys:$hotkey:enabled" "$hotkeysPlist" 2>/dev/null || true)"
            if [ "$enabled" != "false" ]; then
              $DRY_RUN_CMD /usr/libexec/PlistBuddy -c "Set :AppleSymbolicHotKeys:$hotkey:enabled false" "$hotkeysPlist"
              hotkeysChanged=1
            fi
          done
        fi
        if [ "$hotkeysChanged" -eq 1 ]; then
          $DRY_RUN_CMD killall cfprefsd 2>/dev/null || true
          $DRY_RUN_CMD killall SystemUIServer 2>/dev/null || true
        fi
      '';

      # App linking (targets.darwin.linkApps/copyApps) is disabled at
      # stateVersion 25.11, so link the menu bar app into ~/Applications
      # explicitly instead of relying on home.packages app discovery.
      home.file."Applications/CodexBar.app".source = "${codexbar}/Applications/CodexBar.app";
      home.file."Applications/Crisp.app".source = "${crisp}/Applications/Crisp.app";
      home.file."Applications/Ice.app".source = "${ice}/Applications/Ice.app";
      home.file."Applications/SecretBar.app".source = "${secretbar}/Applications/SecretBar.app";
      home.file."Applications/Tidy Ports.app".source = "${tidyports}/Applications/Tidy Ports.app";

      launchd.agents.secretbar = {
        enable = true;
        config = {
          # Launch through LaunchServices (open), not the raw binary:
          # macOS 26 registers menu bar items only for properly launched .app
          # bundles, and the item needs "Allow in the Menu Bar" enabled in
          # System Settings (relaunch after toggling).
          ProgramArguments = [
            "/usr/bin/open"
            "${config.home.homeDirectory}/Applications/SecretBar.app"
          ];
          RunAtLoad = true;
        };
      };

      launchd.agents.tidyports = {
        enable = true;
        config = {
          ProgramArguments = [
            "/usr/bin/open"
            "${config.home.homeDirectory}/Applications/Tidy Ports.app"
          ];
          RunAtLoad = true;
        };
      };

      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs."whatsapp-for-mac"
        pkgs.shottr
        pkgs.raycast
        pkgs.discord
        pkgs."alt-tab-macos"
        pkgs.orbstack
        pkgs.openusage
        codexbar
        crisp
        ice
        secretbar
        tidyports
      ];
    };
}
