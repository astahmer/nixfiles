{ inputs, ... }:
{
  config.flake.modules.homeManager.opencodex =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
      opencodexHome = "${config.home.homeDirectory}/.opencodex";
      configFile = "${opencodexHome}/config.json";
      configTemplate = "${../assets/opencodex/config.template.json}";
      secretsEnv = "${config.home.homeDirectory}/.config/opencodex/secrets.env";
      secretBin = "${inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret}/bin/secret";
      secretConfig = "${../.secret.json}";
      # global-scope aliases (opencode-go-manu/mathias) live in the git-synced
      # global secret config, not the machine-local .secret.json
      globalSecretConfig = "$HOME/.config/nixfiles/assets/secret/global.json";
      ocx = "${opencodex}/bin/ocx";
      jq = "${pkgs.jq}/bin/jq";
      cmp = "${pkgs.diffutils}/bin/cmp";
      gettext = "${pkgs.gettext}/bin";
    in
    {
      # `ocx` wrapper execs `bun` from PATH (same pattern as ghui).
      home.packages = [
        pkgs.bun
        opencodex
      ];

      home.file.".config/opencodex/secrets.env.example".source = ../assets/opencodex/secrets.env.example;

      home.activation.opencodexConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        secrets_dir="${config.home.homeDirectory}/.config/opencodex"
        secrets_file="${secretsEnv}"
        example_file="${config.home.homeDirectory}/.config/opencodex/secrets.env.example"
        opencodex_home="${opencodexHome}"
        config_file="${configFile}"
        config_template="${configTemplate}"
        candidate_config="$config_file.next.$$"
        candidate_with_secrets="$candidate_config.with-secrets"
        current_sorted="$config_file.current.sorted"
        candidate_sorted="$candidate_config.sorted"

        export PATH="${pkgs.bun}/bin:${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${gettext}:${pkgs.jq}/bin:/usr/bin:/bin"
        ${pkgs.coreutils}/bin/mkdir -p "$opencodex_home" "$secrets_dir"

        # Primary source: the repo's Bitwarden-backed secret config. This
        # materializes all four provider keys (commandcode, opencode primary,
        # opencode-go-manu, opencode-go-mathias) so a fresh
        # machine gets the full runtime config without committing keys to the
        # public repo.
        read_secret() {
          local cfg="''${2:-${secretConfig}}"
          ${pkgs.coreutils}/bin/timeout 8s ${secretBin} get --config "$cfg" "$1" 2>/dev/null || true
        }
        OPENCODEX_COMMANDCODE_API_KEY="$(read_secret opencodex-commandcode-api-key)"
        OPENCODEX_OPENCODE_GO_API_KEY="$(read_secret opencode-go-alex)"
        OPENCODEX_OPENCODE_GO_MANU_KEY="$(read_secret opencode-go-manu "${globalSecretConfig}")"
        OPENCODEX_OPENCODE_GO_MATHIAS_KEY="$(read_secret opencode-go-mathias "${globalSecretConfig}")"
        OPENCODEX_CODEX_ALEX2_EMAIL="$(read_secret opencodex-codex-alex2-email)"
        OPENCODEX_CODEX_WORK_EMAIL="$(read_secret opencodex-codex-work-email)"

        # Legacy fallback: ~/.config/opencodex/secrets.env overrides the vault
        # for provider keys explicitly placed there (e.g. when Bitwarden is locked).
        if [ ! -f "$secrets_file" ] && [ -f "$example_file" ]; then
          ${pkgs.coreutils}/bin/cp "$example_file" "$secrets_file"
          ${pkgs.coreutils}/bin/chmod 600 "$secrets_file"
          echo "opencodex: created $secrets_file (fill in API keys)" >&2
        fi

        # Read only the known dotenv assignments. Do not source the file:
        # it is user-owned data and activation must not execute arbitrary shell.
        if [ -r "$secrets_file" ]; then
          while IFS= read -r line || [ -n "$line" ]; do
            secret_name=""
            secret_value=""
            case "$line" in
              OPENCODEX_COMMANDCODE_API_KEY=*)
                secret_name="OPENCODEX_COMMANDCODE_API_KEY"
                secret_value="''${line#*=}"
                ;;
              OPENCODEX_OPENCODE_GO_API_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_API_KEY"
                secret_value="''${line#*=}"
                ;;
              OPENCODEX_OPENCODE_GO_MANU_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_MANU_KEY"
                secret_value="''${line#*=}"
                ;;
              OPENCODEX_OPENCODE_GO_MATHIAS_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_MATHIAS_KEY"
                secret_value="''${line#*=}"
                ;;
              export\ OPENCODEX_COMMANDCODE_API_KEY=*)
                secret_name="OPENCODEX_COMMANDCODE_API_KEY"
                secret_value="''${line#export OPENCODEX_COMMANDCODE_API_KEY=}"
                ;;
              export\ OPENCODEX_OPENCODE_GO_API_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_API_KEY"
                secret_value="''${line#export OPENCODEX_OPENCODE_GO_API_KEY=}"
                ;;
              export\ OPENCODEX_OPENCODE_GO_MANU_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_MANU_KEY"
                secret_value="''${line#export OPENCODEX_OPENCODE_GO_MANU_KEY=}"
                ;;
              export\ OPENCODEX_OPENCODE_GO_MATHIAS_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_MATHIAS_KEY"
                secret_value="''${line#export OPENCODEX_OPENCODE_GO_MATHIAS_KEY=}"
                ;;
            esac
            case "$secret_value" in
              \'*\') secret_value="''${secret_value#\'}"; secret_value="''${secret_value%\'}" ;;
              \"*\") secret_value="''${secret_value#\"}"; secret_value="''${secret_value%\"}" ;;
            esac
            if [ -n "$secret_name" ]; then
              export "$secret_name=$secret_value"
            fi
          done < "$secrets_file"
        fi
        if [ "''${OPENCODEX_COMMANDCODE_API_KEY:-}" = replace-me ]; then
          unset OPENCODEX_COMMANDCODE_API_KEY
        fi
        if [ "''${OPENCODEX_OPENCODE_GO_API_KEY:-}" = replace-me ]; then
          unset OPENCODEX_OPENCODE_GO_API_KEY
        fi
        if [ "''${OPENCODEX_OPENCODE_GO_MANU_KEY:-}" = replace-me ]; then
          unset OPENCODEX_OPENCODE_GO_MANU_KEY
        fi
        if [ "''${OPENCODEX_OPENCODE_GO_MATHIAS_KEY:-}" = replace-me ]; then
          unset OPENCODEX_OPENCODE_GO_MATHIAS_KEY
        fi

        # Use the template only for first-run defaults. Once a config exists,
        # its values win so dashboard and `ocx` edits remain user-owned. Nix
        # still performs the small compatibility/key/selector migrations below.
        if [ -f "$config_file" ]; then
          ${jq} --slurpfile template "$config_template" '
            ($template[0]) as $defaults
            | . as $current
            | ($current.providers // {}) as $currentProviders
            | ($currentProviders["opencode-go"] // null) as $legacyOpenCode
            | (if (($currentProviders | has("opencode")) | not) and ($legacyOpenCode != null)
               then ($current | .providers.opencode = $legacyOpenCode)
               else $current
               end) as $base
            | $base
            | del(.providers["opencode-go"])
            # OpenRouter is intentionally not part of the global setup anymore;
            # remove its old provider and visibility rows from existing configs.
            | del(.providers.openrouter)
            | .disabledModels = (($base.disabledModels // [])
               | map(select((startswith("openrouter/")) | not)))
            | del(.providers.commandcode.disabled)
            # Selectors must always reach their bound account. Older templates
            # paused __main__ by default and OpenCodex auto-pauses drained
            # accounts, which turns quota exhaustion into a misleading 401;
            # a persisted pause must never defeat the bindings below. Pauses
            # are therefore cleared on every activation (rebuild re-enables).
            | del(.pausedCodexAccountIds)
            # Merge the stable account identities from the public template
            # without deleting extra accounts added through the dashboard.
            | (($base.codexAccounts // []) as $existingAccounts
               | ($defaults.codexAccounts // []) as $managedAccounts
               | .codexAccounts = (
                   ($managedAccounts | map(
                     . as $managed
                     | ($existingAccounts | map(select(.id == $managed.id)) | .[0]) as $existing
                     | if $existing == null then $managed else ($managed * $existing) end
                   ))
                   + ($existingAccounts | map(
                       . as $existing
                       | select(($managedAccounts | map(.id) | index($existing.id)) == null)
                     ))
                 ))
            # Account ids are stable provider identities, not machine-local
            # credential-store ids. The email remains secret-backed below.
            | .codexAccountPickerEnabled = true
            | .codexAccountNamespaces = (($base.codexAccountNamespaces // {})
               + ($defaults.codexAccountNamespaces // {}))
            # Seed the complete checked-in model-visibility snapshot only when
            # an older runtime config has no visibility list. A present list,
            # including [], is dashboard-owned so UI toggles remain persistent.
            | if ($base.disabledModels == null)
              then .disabledModels = ($defaults.disabledModels // [])
              else .
              end
          ' "$config_file" > "$candidate_config"
        else
          ${pkgs.coreutils}/bin/cp "$config_template" "$candidate_config"
        fi

        # Materialize configured secrets only for providers and accounts that
        # exist. With no secret value, keep existing values; first-run email
        # placeholders are removed rather than persisted literally.
        ${jq} '
          if (env.OPENCODEX_CODEX_WORK_EMAIL // "") != ""
          then .codexAccounts = ((.codexAccounts // []) | map(
            if .id == "chatgpt-1786023688396"
            then .email = env.OPENCODEX_CODEX_WORK_EMAIL
            else .
            end))
          elif ((.codexAccounts // []) | any(.[]; .id == "chatgpt-1786023688396" and .email == "$OPENCODEX_CODEX_WORK_EMAIL"))
          then .codexAccounts = ((.codexAccounts // []) | map(
            if .id == "chatgpt-1786023688396" then del(.email) else . end))
          else .
          end
          | if (env.OPENCODEX_CODEX_ALEX2_EMAIL // "") != ""
            then .codexAccounts = ((.codexAccounts // []) | map(
              if .id == "chatgpt-1788600942946"
              then .email = env.OPENCODEX_CODEX_ALEX2_EMAIL
              else .
              end))
            elif ((.codexAccounts // []) | any(.[]; .id == "chatgpt-1788600942946" and .email == "$OPENCODEX_CODEX_ALEX2_EMAIL"))
            then .codexAccounts = ((.codexAccounts // []) | map(
              if .id == "chatgpt-1788600942946" then del(.email) else . end))
            else .
            end
          | if (env.OPENCODEX_COMMANDCODE_API_KEY // "") != ""
             and ((.providers // {}) | has("commandcode"))
          then .providers.commandcode.apiKey = env.OPENCODEX_COMMANDCODE_API_KEY
             | .providers.commandcode.apiKeyPool[0].key = env.OPENCODEX_COMMANDCODE_API_KEY
          else .
          end
          | if (env.OPENCODEX_OPENCODE_GO_API_KEY // "") != ""
               and (((.providers // {}) | has("opencode"))
                 or ((.providers // {}) | has("opencode-go-alex")))
            then (if ((.providers // {}) | has("opencode"))
                  then .providers.opencode.apiKey = env.OPENCODEX_OPENCODE_GO_API_KEY
                     | .providers.opencode.apiKeyPool[0].key = env.OPENCODEX_OPENCODE_GO_API_KEY
                  else .
                  end)
               | (if ((.providers // {}) | has("opencode-go-alex"))
                  then .providers["opencode-go-alex"].apiKey = env.OPENCODEX_OPENCODE_GO_API_KEY
                     | .providers["opencode-go-alex"].apiKeyPool[0].key = env.OPENCODEX_OPENCODE_GO_API_KEY
                  else .
                  end)
            else .
            end
          | if (env.OPENCODEX_OPENCODE_GO_MANU_KEY // "") != ""
            then (if ((.providers // {}) | has("opencode-go-manu"))
                  then .providers["opencode-go-manu"].apiKey = env.OPENCODEX_OPENCODE_GO_MANU_KEY
                     | .providers["opencode-go-manu"].apiKeyPool[0].key = env.OPENCODEX_OPENCODE_GO_MANU_KEY
                  else .
                  end)
               | (if (((.providers.opencode.apiKeyPool // []) | length) > 1)
                  then .providers.opencode.apiKeyPool[1].key = env.OPENCODEX_OPENCODE_GO_MANU_KEY
                  else .
                  end)
            else .
            end
          | if (env.OPENCODEX_OPENCODE_GO_MATHIAS_KEY // "") != ""
            then (if ((.providers // {}) | has("opencode-go-mathias"))
                  then .providers["opencode-go-mathias"].apiKey = env.OPENCODEX_OPENCODE_GO_MATHIAS_KEY
                     | .providers["opencode-go-mathias"].apiKeyPool[0].key = env.OPENCODEX_OPENCODE_GO_MATHIAS_KEY
                  else .
                  end)
               | (if ((((.providers.opencode.apiKeyPool // []) | length) > 2))
                  then .providers.opencode.apiKeyPool[2].key = env.OPENCODEX_OPENCODE_GO_MATHIAS_KEY
                  else .
                  end)
            else .
            end
        ' "$candidate_config" > "$candidate_with_secrets"
        ${pkgs.coreutils}/bin/mv "$candidate_with_secrets" "$candidate_config"

        ${ocx} config validate "$candidate_config" --json > /dev/null
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
          ${ocx} config import "$candidate_config" --yes --json > /dev/null
          ${pkgs.coreutils}/bin/chmod 600 "$config_file"
          echo "opencodex: initialized or migrated $config_file" >&2
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$candidate_with_secrets" "$current_sorted" "$candidate_sorted"

        # The upstream service owns its launchd plist and bakes the current
        # Nix-store Bun/CLI paths into it. Repair existing installs; reinstall
        # when a Nix update makes the old service environment stale.
        service_installed="$(${ocx} status --json 2>/dev/null | ${jq} -r '.startup.serviceInstalled // false' 2>/dev/null || echo false)"
        proxy_running="$(${ocx} status --json 2>/dev/null | ${jq} -r '.proxy.running // false' 2>/dev/null || echo false)"
        if [ "$proxy_running" = true ] && [ "$service_installed" != true ]; then
          ${ocx} stop || true
          service_installed=false
        fi

        if [ "$service_installed" = true ]; then
          if ! ${ocx} service repair; then
            ${ocx} service uninstall
            ${ocx} service install
          fi
        else
          ${ocx} service install
        fi
      '';
    };

  config.flake.modules.nixos.opencodex =
    { pkgs, ... }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
    in
    {
      environment.systemPackages = [
        pkgs.bun
        opencodex
      ];
    };
}
