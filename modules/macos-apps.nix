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
      thaw = pkgs.thaw;
      notunes = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.notunes;
      secretbar = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secretbar;
      tidyports = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.tidyports;
      claudeDesktop = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.claude-desktop;
      discordBin = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.discord-bin;
      penDev = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.pen-dev;
      recordly = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.recordly;
      t3codeBin = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.t3code-bin;
      tldrawOffline = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.tldraw-offline;
      zed = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.zed;
      googleChrome = pkgs."google-chrome";
      visualStudioCode = pkgs.vscode;
      cursor = pkgs."code-cursor";
      monitorControl = pkgs.monitorcontrol;
      beekeeperStudio = pkgs."beekeeper-studio";
      chatgpt = pkgs.chatgpt;
      linear = pkgs.linear;
      ghosttyBin = pkgs."ghostty-bin";
      cursorCli = pkgs.writeShellScriptBin "cursor" ''
        exec "${cursor}/bin/cursor" "$@"
      '';
      orbCli = pkgs.writeShellScriptBin "orb" ''
        exec "${pkgs.orbstack}/bin/orb" "$@"
      '';
      codexbarCli = pkgs.writeShellScriptBin "codexbar" ''
        exec "${codexbar}/bin/codexbar" "$@"
      '';
      zedCli = pkgs.writeShellScriptBin "zed" ''
        exec "${zed}/bin/zed" "$@"
      '';
      zeditorCli = pkgs.writeShellScriptBin "zeditor" ''
        exec "${zed}/bin/zeditor" "$@"
      '';
      secretbarLauncher = pkgs.writeShellScript "secretbar-launcher" ''
        /usr/bin/pkill -TERM -f '/Applications/SecretBar.app/Contents/MacOS/secretbar' 2>/dev/null || true
        /bin/sleep 1
        # SECRETBAR_AUTOSTART makes the app hide its window after launch; it
        # is a background resident at login/activation time only.
        exec /usr/bin/open --env SECRETBAR_AUTOSTART=1 "$HOME/Applications/SecretBar.app"
      '';
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };
      cameracontrollerModule = import ../macos/cameracontroller.nix { inherit pkgs lib; };
      cmdcmdModule = import ../macos/cmdcmd.nix { inherit pkgs lib; };
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
      # stateVersion 25.11, so link app bundles into ~/Applications
      # explicitly. GUI packages stay out of home.packages; otherwise Raycast
      # indexes both this link and the profile/store path.
      home.file."Applications/Raycast.app".source = "${pkgs.raycast}/Applications/Raycast.app";
      home.file."Applications/Google Chrome.app".source =
        "${googleChrome}/Applications/Google Chrome.app";
      home.file."Applications/Slack.app".source = "${pkgs.slack}/Applications/Slack.app";
      home.file."Applications/Discord.app".source = "${discordBin}/Applications/Discord.app";
      home.file."Applications/Spotify.app".source = "${pkgs.spotify}/Applications/Spotify.app";
      home.file."Applications/Visual Studio Code.app".source =
        "${visualStudioCode}/Applications/Visual Studio Code.app";
      home.file."Applications/Cursor.app".source = "${cursor}/Applications/Cursor.app";
      home.file."Applications/OrbStack.app".source = "${pkgs.orbstack}/Applications/OrbStack.app";
      home.file."Applications/MonitorControl.app".source =
        "${monitorControl}/Applications/MonitorControl.app";
      home.file."Applications/Beekeeper Studio.app".source =
        "${beekeeperStudio}/Applications/Beekeeper Studio.app";
      home.file."Applications/ChatGPT.app".source = "${chatgpt}/Applications/ChatGPT.app";
      home.file."Applications/Claude.app".source = "${claudeDesktop}/Applications/Claude.app";
      home.file."Applications/Linear.app".source = "${linear}/Applications/Linear.app";
      home.file."Applications/tldraw offline.app".source =
        "${tldrawOffline}/Applications/tldraw offline.app";
      home.file."Applications/Pencil.app".source = "${penDev}/Applications/Pencil.app";
      home.file."Applications/Recordly.app".source = "${recordly}/Applications/Recordly.app";
      home.file."Applications/T3 Code (Alpha).app".source =
        "${t3codeBin}/Applications/T3 Code (Alpha).app";
      home.file."Applications/WhatsApp.app".source =
        "${pkgs."whatsapp-for-mac"}/Applications/WhatsApp.app";
      home.file."Applications/Shottr.app".source = "${pkgs.shottr}/Applications/Shottr.app";
      home.file."Applications/AltTab.app".source = "${pkgs."alt-tab-macos"}/Applications/AltTab.app";
      home.file."Applications/OpenUsage.app".source = "${pkgs.openusage}/Applications/OpenUsage.app";
      home.file."Applications/Ghostty.app".source = "${ghosttyBin}/Applications/Ghostty.app";
      home.file."Applications/CodexBar.app".source = "${codexbar}/Applications/CodexBar.app";
      home.file."Applications/Crisp.app".source = "${crisp}/Applications/Crisp.app";
      home.file."Applications/Thaw.app".source = "${thaw}/Applications/Thaw.app";
      home.file."Applications/noTunes.app".source = "${notunes}/Applications/noTunes.app";
      home.file."Applications/SecretBar.app".source = "${secretbar}/Applications/SecretBar.app";
      home.file."Applications/Tidy Ports.app".source = "${tidyports}/Applications/Tidy Ports.app";
      home.file."Applications/Zed.app".source = "${zed}/Applications/Zed.app";

      # The plist may be unchanged when only the app store path changes. Run
      # the same single-instance launcher during every activation so the live
      # menu-bar process always matches the current Home Manager generation.
      home.activation.restartSecretbar = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
        ${secretbarLauncher}
      '';

      launchd.agents.secretbar = {
        enable = true;
        config = {
          # Restart old store-path instances before launching through
          # LaunchServices, otherwise a Nix switch can leave the old menu
          # bar app alive and macOS will keep reusing it.
          ProgramArguments = [ "${secretbarLauncher}" ];
          RunAtLoad = true;
        };
      };

      launchd.agents.notunes = {
        enable = true;
        config = {
          ProgramArguments = [
            "/usr/bin/open"
            "${config.home.homeDirectory}/Applications/noTunes.app"
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
        cursorCli
        orbCli
        codexbarCli
        zedCli
        zeditorCli
      ];
    };
}
