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
      system = pkgs.stdenv.hostPlatform.system;
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
      whatsappBin = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.whatsapp-bin;
      zed = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.zed;
      shiftshift = inputs.self.packages.${system}.shiftshift;
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
      zedCli = pkgs.writeShellScriptBin "zed" ''
        exec "${zed}/bin/zed" "$@"
      '';
      zeditorCli = pkgs.writeShellScriptBin "zeditor" ''
        exec "${zed}/bin/zeditor" "$@"
      '';
      macosAppSources = {
        "AltTab.app" = "${pkgs."alt-tab-macos"}/Applications/AltTab.app";
        "Beekeeper Studio.app" = "${beekeeperStudio}/Applications/Beekeeper Studio.app";
        "ChatGPT.app" = "${chatgpt}/Applications/ChatGPT.app";
        "Claude.app" = "${claudeDesktop}/Applications/Claude.app";
        "Crisp.app" = "${crisp}/Applications/Crisp.app";
        "Cursor.app" = "${cursor}/Applications/Cursor.app";
        "Discord.app" = "${discordBin}/Applications/Discord.app";
        "Ghostty.app" = "${ghosttyBin}/Applications/Ghostty.app";
        "Google Chrome.app" = "${googleChrome}/Applications/Google Chrome.app";
        "Linear.app" = "${linear}/Applications/Linear.app";
        "MonitorControl.app" = "${monitorControl}/Applications/MonitorControl.app";
        "OrbStack.app" = "${pkgs.orbstack}/Applications/OrbStack.app";
        "Pencil.app" = "${penDev}/Applications/Pencil.app";
        "Raycast.app" = "${pkgs.raycast}/Applications/Raycast.app";
        "Recordly.app" = "${recordly}/Applications/Recordly.app";
        "SecretBar.app" = "${secretbar}/Applications/SecretBar.app";
        "Shottr.app" = "${pkgs.shottr}/Applications/Shottr.app";
        "Slack.app" = "${pkgs.slack}/Applications/Slack.app";
        "Spotify.app" = "${pkgs.spotify}/Applications/Spotify.app";
        "T3 Code (Alpha).app" = "${t3codeBin}/Applications/T3 Code (Alpha).app";
        "Thaw.app" = "${thaw}/Applications/Thaw.app";
        "Tidy Ports.app" = "${tidyports}/Applications/Tidy Ports.app";
        "Visual Studio Code.app" = "${visualStudioCode}/Applications/Visual Studio Code.app";
        "WhatsApp.app" = "${whatsappBin}/Applications/WhatsApp.app";
        "Zed.app" = "${zed}/Applications/Zed.app";
        "noTunes.app" = "${notunes}/Applications/noTunes.app";
        "shiftshift.app" = "${shiftshift}/Applications/shiftshift.app";
        "tldraw offline.app" = "${tldrawOffline}/Applications/tldraw offline.app";
      };
      macosAppInstallCommands = lib.concatStringsSep "\n" (
        lib.mapAttrsToList (
          appName: sourcePath: "install_app ${lib.escapeShellArg appName} ${lib.escapeShellArg sourcePath}"
        ) macosAppSources
      );
      macosAppInstaller = pkgs.writeShellScript "install-macos-apps" ''
        set -eu

        applicationsDirectory="$HOME/Applications"
        stateDirectory="$HOME/.local/state/nixfiles/macos-apps"
        ${pkgs.coreutils}/bin/mkdir -p "$applicationsDirectory" "$stateDirectory"

        install_app() {
          appName="$1"
          sourcePath="$2"
          targetPath="$applicationsDirectory/$appName"
          stampPath="$stateDirectory/$appName.source"
          previousSourcePath=""

          if [ -f "$stampPath" ]; then
            previousSourcePath="$(${pkgs.coreutils}/bin/cat "$stampPath")"
          fi

          if [ -d "$targetPath" ] && [ ! -L "$targetPath" ] && [ "$previousSourcePath" = "$sourcePath" ]; then
            return 0
          fi

          if [ -L "$targetPath" ]; then
            linkTarget="$(${pkgs.coreutils}/bin/readlink "$targetPath")"
            case "$linkTarget" in
              /nix/store/*)
                ;;
              *)
                echo "warning: preserving unmanaged app symlink $targetPath" >&2
                return 0
                ;;
            esac
          elif [ -e "$targetPath" ] && [ -z "$previousSourcePath" ]; then
            echo "warning: preserving unmanaged app bundle $targetPath" >&2
            return 0
          fi

          temporaryDirectory="$(${pkgs.coreutils}/bin/mktemp -d "$applicationsDirectory/.nixfiles-app.XXXXXX")"
          if ! ${lib.getExe pkgs.rsync} \
            --recursive \
            --checksum \
            --perms \
            --links \
            --copy-unsafe-links \
            --specials \
            --chmod=+w \
            "$sourcePath/" "$temporaryDirectory/$appName/"; then
            ${pkgs.coreutils}/bin/rm -rf "$temporaryDirectory"
            return 1
          fi

          if [ -L "$targetPath" ]; then
            ${pkgs.coreutils}/bin/rm "$targetPath"
          elif [ -e "$targetPath" ]; then
            ${pkgs.coreutils}/bin/rm -rf "$targetPath"
          fi
          ${pkgs.coreutils}/bin/mv "$temporaryDirectory/$appName" "$targetPath"
          ${pkgs.coreutils}/bin/rmdir "$temporaryDirectory"
          printf '%s\n' "$sourcePath" > "$stampPath.tmp.$$"
          ${pkgs.coreutils}/bin/mv -f "$stampPath.tmp.$$" "$stampPath"
        }

        ${macosAppInstallCommands}
      '';
      secretbarLauncher = pkgs.writeShellScript "secretbar-launcher" ''
        /usr/bin/pkill -TERM -f '/SecretBar\.app/Contents/MacOS/secretbar' 2>/dev/null || true
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

      home.activation.clearSecretbarSettingsWindowFrame = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD /usr/bin/defaults delete dev.astahmer.secretbar "NSWindow Frame com_apple_SwiftUI_Settings_window" 2>/dev/null || true
      '';

      # Copy app bundles into a writable directory so macOS metadata never
      # mutates the Nix store.
      home.activation.installMacosApps = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
        $DRY_RUN_CMD ${macosAppInstaller}
      '';

      # The plist may be unchanged when only the app store path changes. Run
      # the same single-instance launcher during every activation so the live
      # menu-bar process always matches the current Home Manager generation.
      home.activation.restartSecretbar = lib.hm.dag.entryAfter [ "installMacosApps" ] ''
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
        zedCli
        zeditorCli
      ];
    };
}
