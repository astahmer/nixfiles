{ inputs, ... }:
{
  config.flake.modules.homeManager.shiftshift =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
      shiftshift = inputs.self.packages.${system}.shiftshift;
      # macOS TCC grants belong to the writable bundle that the user enables
      # in System Settings, not the immutable store path used to build it.
      shiftshiftApp = "${config.home.homeDirectory}/Applications/shiftshift.app";
      configTemplate = ../assets/shiftshift/config.json;
      appDataDir = "${config.home.homeDirectory}/Library/Application Support/dev.shiftshift.tauri";
      shiftshiftLauncher = pkgs.writeShellScript "shiftshift-launcher" ''
        export SHIFTSHIFT_MANAGED_LAUNCHD=1
        # iCloud evicts the folder backend's entry files and the app reads them
        # all at startup. `brctl download <dir>` does not recurse, so request
        # each evicted file, in the background so the launch is not delayed.
        folder_path="$(${pkgs.jq}/bin/jq -r 'select(.backend == "folder") | .folder_path // empty' \
          "${appDataDir}/settings.json" 2>/dev/null || true)"
        if [ -n "$folder_path" ] && [ -x /usr/bin/brctl ]; then
          /usr/bin/find "''${folder_path/#\~/$HOME}" -flags +dataless -name '*.json' -print0 2>/dev/null \
            | /usr/bin/xargs -0 -n 100 /usr/bin/brctl download >/dev/null 2>&1 &
        fi
        exec "${shiftshiftApp}/Contents/MacOS/shiftshift-tauri" "$@"
      '';
      activationLib = import ../lib/activation.nix { inherit pkgs; };
      shiftshiftPlist = pkgs.writeText "shiftshift.plist" ''
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>shiftshift</string>
          <key>ProcessType</key>
          <string>Interactive</string>
          <key>ProgramArguments</key>
          <array>
            <string>${shiftshiftLauncher}</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
        </dict>
        </plist>
      '';
      shiftCli = pkgs.writeShellScriptBin "shift" ''
        exec "${shiftshift}/bin/shift" "$@"
      '';
    in
    {
      # macosApps copies the GUI bundle into ~/Applications; expose only the
      # CLI here so app discovery does not see the same bundle twice.
      home.packages = [ shiftCli ];

      home.shellAliases = lib.mkIf isDarwin {
        shiftshift-status = "launchctl print \"gui/$(id -u)/shiftshift\"";
        shiftshift-restart = "launchctl kickstart -k \"gui/$(id -u)/shiftshift\"";
      };

      home.activation.shiftshiftLaunchd = lib.mkIf isDarwin (
        lib.hm.dag.entryAfter [ "installMacosApps" ] ''
          . ${activationLib}
          nixfiles_launch_agent_install shiftshift "${shiftshiftPlist}"
        ''
      );

      # The app writes these files itself, so a home.file symlink would make
      # settings writes target the read-only Nix store. Seed each file once
      # from the versioned portable backup instead, then leave it user-owned.
      home.file.".config/shiftshift/config.json".source = configTemplate;
      # Bundle copies share this app-data folder, so manual launches also
      # defer login-item ownership to the Nix LaunchAgent.
      home.file."Library/Application Support/dev.shiftshift.tauri/.nix-launchd-managed".text = "";
      home.activation.shiftshiftConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        app_data_dir="${appDataDir}"
        backup_file="${configTemplate}"
        mkdir -p "$app_data_dir"

        seed_file() {
          target="$app_data_dir/$1"
          if [ ! -e "$target" ]; then
            ${pkgs.jq}/bin/jq "$2" "$backup_file" > "$target.next.$$"
            ${pkgs.coreutils}/bin/mv "$target.next.$$" "$target"
            ${pkgs.coreutils}/bin/chmod 600 "$target"
            echo "shiftshift: initialized $target" >&2
          fi
        }

        seed_file settings.json '.settings'
        seed_file templates.json '.templates'
        seed_file custom_themes.json '.custom_themes'
      '';
    };
}
