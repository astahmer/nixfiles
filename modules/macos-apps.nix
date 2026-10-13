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
      homeManagerProfileWrapper =
        name: binaryVariable:
        let
          binaryReference = "$" + binaryVariable;
        in
        pkgs.writeShellScript "home-manager-${name}-profile-wrapper" ''
          binary="${binaryReference}"
          log_file="$HOME/.local/state/nixfiles/home-manager-nix-profile.log"
          ${pkgs.coreutils}/bin/mkdir -p "$HOME/.local/state/nixfiles" 2>/dev/null || true
          started="$SECONDS"
          printf 'started %ss ${name} %s %s\n' "$started" "$1" "$2" >> "$log_file" 2>/dev/null || true

          if [ -z "$binary" ]; then
            status=127
          elif ${pkgs.coreutils}/bin/timeout --kill-after=5s 120s "$binary" "$@"; then
            status=0
          else
            status="$?"
          fi

          elapsed=$((SECONDS - started))
          printf 'finished %ss ${name} after %ss (status %s)\n' "$SECONDS" "$elapsed" "$status" >> "$log_file" 2>/dev/null || true
          exit "$status"
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
        "Raycast.app" = "${pkgs.raycast}/Applications/Raycast.app";
        "Recordly.app" = "${recordly}/Applications/Recordly.app";
        "SecretBar.app" = "${secretbar}/Applications/SecretBar.app";
        "Shottr.app" = "${pkgs.shottr}/Applications/Shottr.app";
        "Slack.app" = "${pkgs.slack}/Applications/Slack.app";
        "Spotify.app" = "${pkgs.spotify}/Applications/Spotify.app";
        "T3 Code (Nightly).app" = "${t3codeBin}/Applications/T3 Code (Nightly).app";
        "Thaw.app" = "${thaw}/Applications/Thaw.app";
        "Tidy Ports.app" = "${tidyports}/Applications/Tidy Ports.app";
        "Visual Studio Code.app" = "${visualStudioCode}/Applications/Visual Studio Code.app";
        "WhatsApp.app" = "${whatsappBin}/Applications/WhatsApp.app";
        "Zed.app" = "${zed}/Applications/Zed.app";
        "noTunes.app" = "${notunes}/Applications/noTunes.app";
        "shiftshift.app" = "${shiftshift}/Applications/shiftshift.app";
        "tldraw offline.app" = "${tldrawOffline}/Applications/tldraw offline.app";
      };
      allMacosAppSources = macosAppSources // config.macosAppSources;
      macosAppInstallCommands = lib.concatStringsSep "\n" (
        lib.mapAttrsToList (
          appName: sourcePath: "install_app ${lib.escapeShellArg appName} ${lib.escapeShellArg sourcePath}"
        ) allMacosAppSources
      );
      macosAppInstaller = pkgs.writeShellScript "install-macos-apps" ''
        set -eu

        applicationsDirectory="$HOME/Applications"
        stateDirectory="$HOME/.local/state/nixfiles/macos-apps"
        temporaryDirectory=""
        ${pkgs.coreutils}/bin/mkdir -p "$applicationsDirectory" "$stateDirectory"

        cleanup_temporary_directory() {
          if [ -n "$temporaryDirectory" ] && [ -d "$temporaryDirectory" ]; then
            ${pkgs.coreutils}/bin/timeout --kill-after=5s 20s \
              ${pkgs.coreutils}/bin/rm -rf "$temporaryDirectory" || true
          fi
        }
        trap cleanup_temporary_directory EXIT

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

          started="$SECONDS"
          printf '[nixfiles:installMacosApps] %s copy started\n' "$appName" >&2
          temporaryDirectory="$(${pkgs.coreutils}/bin/mktemp -d "$applicationsDirectory/.nixfiles-app.XXXXXX")"
          if ${pkgs.coreutils}/bin/timeout --kill-after=5s 180s ${lib.getExe pkgs.rsync} \
            --recursive \
            --perms \
            --links \
            --copy-unsafe-links \
            --specials \
            --chmod=+w \
            "$sourcePath/" "$temporaryDirectory/$appName/"; then
            elapsed=$((SECONDS - started))
            printf '[nixfiles:installMacosApps] %s copy completed in %ss\n' "$appName" "$elapsed" >&2
          else
            status="$?"
            elapsed=$((SECONDS - started))
            printf '[nixfiles:installMacosApps] %s copy failed after %ss (status %s)\n' "$appName" "$elapsed" "$status" >&2
            return "$status"
          fi

          backupPath="$targetPath.nixfiles-backup.$$"
          if [ -L "$targetPath" ]; then
            if ! ${pkgs.coreutils}/bin/mv "$targetPath" "$backupPath"; then
              return 1
            fi
          elif [ -e "$targetPath" ]; then
            if ! ${pkgs.coreutils}/bin/mv "$targetPath" "$backupPath"; then
              return 1
            fi
          fi
          if ! ${pkgs.coreutils}/bin/mv "$temporaryDirectory/$appName" "$targetPath"; then
            if [ -e "$backupPath" ] || [ -L "$backupPath" ]; then
              if ! ${pkgs.coreutils}/bin/mv "$backupPath" "$targetPath"; then
                echo "error: failed to install $appName and restore its previous bundle from $backupPath" >&2
                return 1
              fi
            fi
            return 1
          fi
          ${pkgs.coreutils}/bin/rmdir "$temporaryDirectory"
          temporaryDirectory=""
          printf '%s\n' "$sourcePath" > "$stampPath.tmp.$$"
          ${pkgs.coreutils}/bin/mv -f "$stampPath.tmp.$$" "$stampPath"
          if [ -e "$backupPath" ] || [ -L "$backupPath" ]; then
            if ! ${pkgs.coreutils}/bin/timeout --kill-after=5s 30s \
              ${pkgs.coreutils}/bin/rm -rf "$backupPath"; then
              echo "warning: retained previous app bundle at $backupPath" >&2
            fi
          fi
        }

        ${macosAppInstallCommands}
      '';
      secretbarLauncher = pkgs.writeShellScript "secretbar-launcher" ''
        ${pkgs.coreutils}/bin/timeout --kill-after=2s 5s \
          /usr/bin/pkill -TERM -f '/SecretBar\.app/Contents/MacOS/secretbar' 2>/dev/null || true
        /bin/sleep 1
        # SECRETBAR_AUTOSTART makes the app hide its window after launch; it
        # is a background resident at login/activation time only.
        exec ${pkgs.coreutils}/bin/timeout --kill-after=5s 15s \
          /usr/bin/open --env SECRETBAR_AUTOSTART=1 "$HOME/Applications/SecretBar.app"
      '';
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };
      cameracontrollerModule = import ../macos/cameracontroller.nix { inherit pkgs lib; };
      cmdcmdModule = import ../macos/cmdcmd.nix { inherit pkgs lib; };
      cleanshotModule = import ../macos/cleanshot.nix { inherit pkgs lib; };
      caffeineModule = import ../macos/caffeine.nix { inherit pkgs lib; };
      cleanMyKeyboardId = "6468120888";
      mas = lib.getExe pkgs.mas;
      macosAppSourcesOption = {
        options.macosAppSources = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          description = ''
            App bundles produced by other modules. Home Manager cannot link
            a directory into $HOME, so a `.app` may not be a `home.file`
            source; registering it here makes the installer rsync-copy the
            bundle into ~/Applications instead.
          '';
        };
      };
      # huesyncModule = import ../macos/huesync.nix { inherit pkgs lib; };
    in
    {
      imports = [
        macosAppSourcesOption
        backgroundMusicModule
        cameracontrollerModule
        cmdcmdModule
        cleanshotModule
        caffeineModule
        # huesyncModule
      ];

      home.file.".local/lib/nixfiles/home-manager-profile-bin/nix".source =
        homeManagerProfileWrapper "nix" "NIXFILES_HM_NIX_BIN";
      home.file.".local/lib/nixfiles/home-manager-profile-bin/nix-env".source =
        homeManagerProfileWrapper "nix-env" "NIXFILES_HM_NIX_ENV_BIN";

      home.activation.boundHomeManagerNixProfile =
        (lib.hm.dag.entryAfter [ "linkGeneration" "removeStandaloneMise" ] ''
          nix_binary="$(type -P nix || true)"
          if [ -z "$nix_binary" ]; then
            echo "failed: cannot find nix before Home Manager profile activation" >&2
            exit 1
          fi
          export NIXFILES_HM_NIX_BIN="$nix_binary"
          export NIXFILES_HM_NIX_ENV_BIN="$(type -P nix-env || true)"
          export PATH="$HOME/.local/lib/nixfiles/home-manager-profile-bin:$PATH"
        '')
        // {
          before = [ "installPackages" ];
        };

      home.activation.cleanMyKeyboard = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if installedApps="$(
          ${pkgs.coreutils}/bin/timeout --kill-after=2s 10s "${mas}" list 2>/dev/null
        )"; then
          case "$installedApps" in
            *"${cleanMyKeyboardId}"*) ;;
            *)
              # mas install escalates to sudo, which an unattended activation
              # cannot answer; a failed install must not abort the whole switch.
              $DRY_RUN_CMD ${pkgs.coreutils}/bin/timeout --kill-after=5s 120s \
                "${mas}" install ${cleanMyKeyboardId} 2>/dev/null ||
                echo "warning: could not install CleanMyKeyboard; run mas install ${cleanMyKeyboardId} manually" >&2
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
        started="$SECONDS"
        printf '[nixfiles:installMacosApps] activation started\n' >&2
        if $DRY_RUN_CMD ${pkgs.coreutils}/bin/timeout --kill-after=15s 300s ${macosAppInstaller}; then
          elapsed=$((SECONDS - started))
          printf '[nixfiles:installMacosApps] activation completed in %ss\n' "$elapsed" >&2
        else
          status="$?"
          elapsed=$((SECONDS - started))
          printf '[nixfiles:installMacosApps] activation failed after %ss (status %s)\n' "$elapsed" "$status" >&2
          exit "$status"
        fi
      '';

      home.activation.boundHomeManagerLaunchctl =
        (lib.hm.dag.entryAfter [ "linkGeneration" ] ''
          run() {
            local output_mode=""
            if [[ "''${1:-}" == "--quiet" ]]; then
              output_mode="quiet"
              shift
            elif [[ "''${1:-}" == "--silence" ]]; then
              output_mode="silence"
              shift
            fi

            if [[ -v DRY_RUN ]]; then
              echo "$@"
              return 0
            fi

            if [[ "''${1:-}" != "/bin/launchctl" ]]; then
              if [[ "$output_mode" == "quiet" ]]; then
                "$@" > /dev/null
              elif [[ "$output_mode" == "silence" ]]; then
                "$@" > /dev/null 2>&1
              else
                "$@"
              fi
              return "$?"
            fi

            local operation="$2"
            local started="$SECONDS"
            local status
            local log_file="$HOME/.local/state/nixfiles/home-manager-launchd.log"
            ${pkgs.coreutils}/bin/mkdir -p "$(dirname "$log_file")"
            if [ ! -e "$log_file" ]; then
              (umask 077; : > "$log_file")
            fi
            printf 'started %ss launchctl %s\n' "$started" "$operation" >> "$log_file" 2>/dev/null || true

            if [[ "$output_mode" == "quiet" ]]; then
              if ${pkgs.coreutils}/bin/timeout --kill-after=5s 15s "$@" > /dev/null; then
                status=0
              else
                status="$?"
              fi
            elif [[ "$output_mode" == "silence" ]]; then
              if ${pkgs.coreutils}/bin/timeout --kill-after=5s 15s "$@" > /dev/null 2>&1; then
                status=0
              else
                status="$?"
              fi
            elif ${pkgs.coreutils}/bin/timeout --kill-after=5s 15s "$@"; then
              status=0
            else
              status="$?"
            fi

            local elapsed=$((SECONDS - started))
            if [ "$status" -eq 0 ]; then
              printf 'completed %ss launchctl %s in %ss\n' "$SECONDS" "$operation" "$elapsed" >> "$log_file" 2>/dev/null || true
            else
              printf 'failed %ss launchctl %s after %ss (status %s)\n' "$SECONDS" "$operation" "$elapsed" "$status" >> "$log_file" 2>/dev/null || true
            fi
            return "$status"
          }
        '')
        // {
          before = [ "setupLaunchAgents" ];
        };

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
