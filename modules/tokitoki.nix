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
      jq = "${pkgs.jq}/bin/jq";
      cmp = "${pkgs.diffutils}/bin/cmp";
      menubarLauncher = pkgs.writeShellScript "tokitoki-menubar-launcher" ''
        export TOKITOKI_BIN="${tokitoki}/bin/tokitoki"
        exec "${tokitokiMenubar}/bin/tokitoki-menubar" "$@"
      '';
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
          ${jq} --slurpfile template "$config_template" '
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
          ' "$config_file" > "$candidate_config"
        else
          ${pkgs.coreutils}/bin/cp "$config_template" "$candidate_config"
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

      launchd.agents.tokitoki = lib.mkIf isDarwin {
        enable = true;
        config = {
          ProgramArguments = [ "${menubarLauncher}" ];
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 5;
          ProcessType = "Interactive";
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/tokitoki.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/tokitoki.log";
        };
      };
    };
}
