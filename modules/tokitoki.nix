{ inputs, ... }:
{
  config.flake.modules.homeManager.tokitoki =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
      tokitoki = inputs.self.packages.${system}.tokitoki;
      tokitokiMenubar = inputs.self.packages.${system}."tokitoki-menubar";
      secretBin = "${inputs.self.packages.${system}.secret}/bin/secret";
      globalSecretConfig = "${../assets/secret/global.json}";
      secretConfig = "${../.secret.json}";
      configFile = "${config.home.homeDirectory}/.config/tokitoki/config.json";
      configTemplate = "${../assets/tokitoki/config.template.json}";
      icloudRoot = "${config.home.homeDirectory}/Library/Mobile Documents/com~apple~CloudDocs";
      icloudSyncDir = "${icloudRoot}/tokitoki";
      jq = "${pkgs.jq}/bin/jq";
      cmp = "${pkgs.diffutils}/bin/cmp";
      syncLauncher = pkgs.writeShellScript "tokitoki-sync" ''
        set -eu
        icloud_root="${icloudRoot}"
        if [ ! -d "$icloud_root" ]; then
          echo "tokitoki-sync: waiting for iCloud Drive at $icloud_root" >&2
          exit 0
        fi
        exec "${tokitoki}/bin/tokitoki" sync --backend dir --both
      '';
      menubarLabel = "org.nix-community.home.tokitoki";
      syncLabel = "org.nix-community.home.tokitoki-sync";
      menubarPlist = pkgs.writeText "${menubarLabel}.plist" (
        lib.generators.toPlist { escape = true; } {
          Label = menubarLabel;
          ProgramArguments = [ "${tokitokiMenubar}/bin/tokitoki-menubar" ];
          EnvironmentVariables = {
            TOKITOKI_BIN = "${tokitoki}/bin/tokitoki";
          };
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 5;
          ProcessType = "Interactive";
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/tokitoki.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/tokitoki.log";
        }
      );
      syncPlist = pkgs.writeText "${syncLabel}.plist" (
        lib.generators.toPlist { escape = true; } {
          Label = syncLabel;
          ProgramArguments = [
            "/bin/sh"
            "-c"
            "/bin/wait4path /nix/store && exec ${lib.escapeShellArgs [ "${syncLauncher}" ]}"
          ];
          RunAtLoad = true;
          StartInterval = 300;
          ThrottleInterval = 30;
          ProcessType = "Background";
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/tokitoki-sync.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/tokitoki-sync.log";
        }
      );
    in
    {
      home.packages = [ tokitoki ] ++ lib.optionals isDarwin [ tokitokiMenubar ];

      home.activation.tokitokiConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        config_dir="${config.home.homeDirectory}/.config/tokitoki"
        config_file="${configFile}"
        config_template="${configTemplate}"
        candidate_config="$config_file.next.$$"
        candidate_with_secrets="$candidate_config.with-secrets"
        current_sorted="$candidate_config.current.sorted"
        candidate_sorted="$candidate_config.sorted"

        export PATH="${pkgs.bitwarden-cli}/bin:${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${pkgs.jq}/bin:/usr/bin:/bin"
        export TOKITOKI_OPENCODE_GO_MATHIAS=""
        export TOKITOKI_OPENCODE_GO_MANU=""
        export TOKITOKI_OPENCODE_GO_ALEX=""
        umask 077
        ${pkgs.coreutils}/bin/mkdir -p "$config_dir"

        read_secret() {
          ${pkgs.coreutils}/bin/timeout 8s "${secretBin}" get --config "$2" "$1" 2>/dev/null || true
        }

        # The values stay in process memory and are consumed through jq's
        # environment interface; neither the template nor the Nix store gets
        # a credential. These aliases are shared with OpenCodex's provider
        # configuration and are value-free in the checked-in secret configs.
        # The shared accounts live in global.json; the personal account is a
        # project alias because it is already used by OpenCodex.
        TOKITOKI_OPENCODE_GO_MATHIAS="$(read_secret opencode-go-mathias "${globalSecretConfig}")"
        TOKITOKI_OPENCODE_GO_MANU="$(read_secret opencode-go-manu "${globalSecretConfig}")"
        TOKITOKI_OPENCODE_GO_ALEX="$(read_secret opencode-go-alex "${secretConfig}")"
        export TOKITOKI_OPENCODE_GO_MATHIAS TOKITOKI_OPENCODE_GO_MANU TOKITOKI_OPENCODE_GO_ALEX

        if [ -f "$config_file" ]; then
          ${jq} --arg sync_path "${icloudSyncDir}" --slurpfile template "$config_template" '
            ($template[0].poll.extraKeys // []) as $managed
            | . as $current
            | (($current.poll.extraKeys // []) as $existing
              | .poll.extraKeys = (
                  ($managed | map(
                    . as $default
                    | ($existing | map(select(.id == $default.id)) | .[0]) as $currentKey
                    | if $currentKey == null then $default else $currentKey end
                  ))
                  + ($existing | map(
                    . as $currentKey
                    | select(($managed | map(.id) | index($currentKey.id)) == null)
                  ))
                ))
            | .sync = (
                if (.sync // null) == null then
                  {backend: "dir", path: $sync_path}
                elif .sync.backend == "git" and ((.sync.url // "") == "") then
                  {backend: "dir", path: $sync_path}
                elif .sync.backend == "dir" and ((.sync.path // "") == "") then
                  .sync + {path: $sync_path}
                else .sync end
              )
          ' "$config_file" > "$candidate_config"
        else
          ${jq} --arg sync_path "${icloudSyncDir}" \
            '.sync.path = $sync_path' "$config_template" > "$candidate_config"
        fi

        ${jq} '
          def remove_openrouter:
            del(.budgets.accounts.openrouter)
            | if .ui.hidden.menubar? then
                .ui.hidden.menubar |= map(select((contains("openrouter") | not)))
              else . end
            | if .ui.previewHidden? then
                .ui.previewHidden |= map(select(. != "openrouter"))
              else . end
            | if .poll.extraKeys? then
                .poll.extraKeys |= map(select(.provider != "openrouter"))
              else . end;

          def apply_key($id; $value; $placeholder):
            if $value != "" then
              .poll.extraKeys = ((.poll.extraKeys // []) | map(
                if .id == $id then .key = $value else . end
              ))
            else
              .poll.extraKeys = ((.poll.extraKeys // []) | map(
                select(.id != $id or .key != $placeholder)
              ))
            end;

          remove_openrouter
          | apply_key(
              "opencode-go-mathias";
              (env.TOKITOKI_OPENCODE_GO_MATHIAS // "");
              "__TOKITOKI_SECRET_OPENCODE_GO_MATHIAS__"
            )
          | apply_key(
              "opencode-go-manu";
              (env.TOKITOKI_OPENCODE_GO_MANU // "");
              "__TOKITOKI_SECRET_OPENCODE_GO_MANU__"
            )
          | apply_key(
              "opencode-go-alex";
              (env.TOKITOKI_OPENCODE_GO_ALEX // "");
              "__TOKITOKI_SECRET_OPENCODE_GO_ALEX__"
            )
        ' "$candidate_config" > "$candidate_with_secrets"
        ${pkgs.coreutils}/bin/mv "$candidate_with_secrets" "$candidate_config"
        ${jq} empty "$candidate_config" > /dev/null
        ${jq} -S . "$candidate_config" > "$candidate_sorted"

        config_changed=0
        if [ ! -f "$config_file" ]; then
          config_changed=1
        else
          ${jq} -S . "$config_file" > "$current_sorted"
          if ! ${cmp} -s "$current_sorted" "$candidate_sorted"; then
            config_changed=1
          fi
        fi

        if [ "$config_changed" -eq 1 ]; then
          ${pkgs.coreutils}/bin/mv "$candidate_config" "$config_file"
          ${pkgs.coreutils}/bin/chmod 600 "$config_file"
          echo "tokitoki: initialized or migrated $config_file" >&2
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$candidate_with_secrets" "$current_sorted" "$candidate_sorted"
      '';

      home.activation.tokitokiLaunchd = lib.mkIf isDarwin (
        lib.hm.dag.entryAfter [ "tokitokiConfig" ] ''
          agents_dir="${config.home.homeDirectory}/Library/LaunchAgents"
          uid="$(/usr/bin/id -u)"
          ${pkgs.coreutils}/bin/mkdir -p "$agents_dir"

          bootout_agent() {
            /bin/launchctl bootout "gui/$uid/$1" >/dev/null 2>&1 || true
          }

          install_agent() {
            label="$1"
            source="$2"
            destination="$agents_dir/$label.plist"
            bootout_agent "$label"
            ${pkgs.coreutils}/bin/install -m 600 "$source" "$destination.next.$$"
            ${pkgs.coreutils}/bin/mv -f "$destination.next.$$" "$destination"
            /bin/launchctl bootstrap "gui/$uid" "$destination"
          }

          # Replace the legacy hand-installed agent so it cannot run beside
          # the Nix-managed process or resurrect itself at the next login.
          legacy_label="dev.tokitoki.menubar"
          legacy_plist="$agents_dir/$legacy_label.plist"
          if [ -e "$legacy_plist" ]; then
            bootout_agent "$legacy_label"
            legacy_backup="$legacy_plist.hm-backup"
            if [ -e "$legacy_backup" ]; then
              legacy_backup="$legacy_plist.hm-backup.$(/bin/date +%Y%m%d%H%M%S)"
            fi
            ${pkgs.coreutils}/bin/mv "$legacy_plist" "$legacy_backup"
          fi

          install_agent "${menubarLabel}" "${menubarPlist}"
          install_agent "${syncLabel}" "${syncPlist}"
        ''
      );
    };
}
