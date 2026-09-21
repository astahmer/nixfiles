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
      codexConfigFile = "${config.home.homeDirectory}/.codex/config.toml";
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

        # /usr/bin last: macOS find lacks -printf, which home-manager's
        # own activation steps rely on.
        export PATH="${pkgs.bun}/bin:${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${gettext}:${pkgs.jq}/bin:$PATH:/usr/bin:/bin"
        ${pkgs.coreutils}/bin/mkdir -p "$opencodex_home" "$secrets_dir"

        # ${secretBin} is the raw CLI: unlike the `secret` shell alias from
        # the bitwarden module, it does not recover a Keychain-stored
        # Bitwarden session on its own. Activation runs outside that
        # interactive shell, so recover the same way here or every lookup
        # below silently returns empty.
        if [ -z "''${BW_SESSION:-}" ]; then
          # Keychain access can transiently fail right after the profile
          # swap above; a couple of retries smooths over that race instead
          # of silently leaving every secret lookup below empty.
          stored_bw_session=""
          keychain_attempt=1
          while [ -z "$stored_bw_session" ] && [ "$keychain_attempt" -le 3 ]; do
            stored_bw_session="$(${pkgs.coreutils}/bin/timeout 5s /usr/bin/security find-generic-password -a bitwarden-session -s secret-cli -w 2>/dev/null || true)"
            [ -n "$stored_bw_session" ] || ${pkgs.coreutils}/bin/sleep 1
            keychain_attempt=$((keychain_attempt + 1))
          done
          if [ -n "$stored_bw_session" ]; then
            export BW_SESSION="$stored_bw_session"
          fi
        fi

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
        # The jq pass below reads these through `env.*`, which only sees
        # exported variables.
        export OPENCODEX_COMMANDCODE_API_KEY OPENCODEX_OPENCODE_GO_API_KEY \
          OPENCODEX_OPENCODE_GO_MANU_KEY OPENCODEX_OPENCODE_GO_MATHIAS_KEY \
          OPENCODEX_CODEX_ALEX2_EMAIL OPENCODEX_CODEX_WORK_EMAIL

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

        # If Bitwarden is temporarily unavailable, do not replace a working
        # provider credential with the template placeholder. The value stays
        # in the local OCX config and is never printed by this activation.
        if [ -f "$config_file" ]; then
          if [ -z "''${OPENCODEX_COMMANDCODE_API_KEY:-}" ]; then
            old_secret="$(${jq} -r '.providers.commandcode.apiKey // empty' "$config_file" 2>/dev/null || true)"
            case "$old_secret" in
              ""|replace-me|\$*) ;;
              *) export OPENCODEX_COMMANDCODE_API_KEY="$old_secret" ;;
            esac
          fi
          if [ -z "''${OPENCODEX_OPENCODE_GO_API_KEY:-}" ]; then
            old_secret="$(${jq} -r '.providers["opencode-go-alex"].apiKey // .providers.opencode.apiKey // empty' "$config_file" 2>/dev/null || true)"
            case "$old_secret" in
              ""|replace-me|\$*) ;;
              *) export OPENCODEX_OPENCODE_GO_API_KEY="$old_secret" ;;
            esac
          fi
          if [ -z "''${OPENCODEX_OPENCODE_GO_MANU_KEY:-}" ]; then
            old_secret="$(${jq} -r '.providers["opencode-go-manu"].apiKey // .providers.opencode.apiKeyPool[1].key // empty' "$config_file" 2>/dev/null || true)"
            case "$old_secret" in
              ""|replace-me|\$*) ;;
              *) export OPENCODEX_OPENCODE_GO_MANU_KEY="$old_secret" ;;
            esac
          fi
          if [ -z "''${OPENCODEX_OPENCODE_GO_MATHIAS_KEY:-}" ]; then
            old_secret="$(${jq} -r '.providers["opencode-go-mathias"].apiKey // .providers.opencode.apiKeyPool[2].key // empty' "$config_file" 2>/dev/null || true)"
            case "$old_secret" in
              ""|replace-me|\$*) ;;
              *) export OPENCODEX_OPENCODE_GO_MATHIAS_KEY="$old_secret" ;
            esac
          fi
        fi

        # Stop the proxy before replacing its config so the running process
        # cannot write stale routing state back over the managed snapshot.
        ocx_status="$(${ocx} status --json 2>/dev/null || printf '%s' '{}')"
        proxy_running="$(printf '%s\n' "$ocx_status" | ${jq} -r '.proxy.running // false' 2>/dev/null || printf '%s' false)"
        service_version_skewed="$(printf '%s\n' "$ocx_status" | ${jq} -r '.versionSkew.skewed // false' 2>/dev/null || printf '%s' false)"
        if [ "$proxy_running" = true ]; then
          if ! ${ocx} stop; then
            echo "opencodex: could not stop the proxy before config reconciliation" >&2
            exit 1
          fi
        fi

        # The old Codex template seeded this exact loopback URL. Remove only
        # an unmarked copy so OpenCodex can own routing injection; preserve
        # a URL already marked as OpenCodex-managed.
        if [ -f "${codexConfigFile}" ]; then
          legacy_codex_config="${codexConfigFile}.legacy.$$"
          ${pkgs.gawk}/bin/awk '
            {
              is_legacy_proxy = $0 ~ /^[[:space:]]*openai_base_url[[:space:]]*=[[:space:]]*"http:\/\/127\.0\.0\.1:10100\/v1"[[:space:]]*$/
              is_opencodex_marker = previous_line ~ /^[[:space:]]*# Auto-injected by opencodex[[:space:]]*$/
              if (is_legacy_proxy && !is_opencodex_marker) {
                previous_line = ""
                next
              }
              print
              previous_line = $0
            }
          ' "${codexConfigFile}" > "$legacy_codex_config"
          if ! ${cmp} -s "$legacy_codex_config" "${codexConfigFile}"; then
            ${pkgs.coreutils}/bin/mv "$legacy_codex_config" "${codexConfigFile}"
          else
            ${pkgs.coreutils}/bin/rm -f "$legacy_codex_config"
          fi
        fi

        # The checked-in template owns OpenCodex's providers, model visibility,
        # picker state, and routing defaults on every apply. Preserve only the
        # connected account metadata from the current config: pool credentials
        # live in codex-accounts.json and must not be invalidated by Nix.
        if [ -f "$config_file" ]; then
          ${jq} --slurpfile template "$config_template" '
            ($template[0]) as $defaults
            | . as $current
            | $defaults
            | .codexAccounts = ($current.codexAccounts // [])
            | .codexAccountNamespaces = (($defaults.codexAccountNamespaces // {})
               + ($current.codexAccountNamespaces // {}))
          ' "$config_file" > "$candidate_config"
        else
          ${pkgs.coreutils}/bin/cp "$config_template" "$candidate_config"
        fi

        # Materialize configured secrets only for providers and accounts that
        # exist. With no secret value, keep existing values.
        ${jq} '
          # Label whichever live account currently owns each known email,
          # rather than a hardcoded chatgpt-<id>: ocx mints a fresh id on
          # every browser re-auth, and ids differ per machine entirely.
          # This self-heals after a re-login or on a new machine, as soon
          # as an account with that email exists.
          (if (env.OPENCODEX_CODEX_WORK_EMAIL // "") != ""
           then .codexAccounts = ((.codexAccounts // []) | map(
                  if .email == env.OPENCODEX_CODEX_WORK_EMAIL then . + {alias: "codex-work"} else . end
                ))
              | (((.codexAccounts // []) | map(select(.email == env.OPENCODEX_CODEX_WORK_EMAIL)) | .[0].id) // null) as $workId
              | if $workId != null then .codexAccountNamespaces["codex-work"] = $workId else . end
           else . end)
          | (if (env.OPENCODEX_CODEX_ALEX2_EMAIL // "") != ""
             then .codexAccounts = ((.codexAccounts // []) | map(
                    if .email == env.OPENCODEX_CODEX_ALEX2_EMAIL then . + {alias: "codex-alex2"} else . end
                  ))
                | (((.codexAccounts // []) | map(select(.email == env.OPENCODEX_CODEX_ALEX2_EMAIL)) | .[0].id) // null) as $alex2Id
                | if $alex2Id != null then .codexAccountNamespaces["codex-alex2"] = $alex2Id else . end
             else . end)
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
          echo "opencodex: reconciled managed config and preserved connected accounts" >&2
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$candidate_with_secrets" "$current_sorted" "$candidate_sorted"

        # The upstream service owns its launchd plist and bakes the current
        # Nix-store Bun/CLI paths into it. Repair definitions normally, but
        # restart when the profile symlink advanced while the old proxy lived.
        service_installed="$(${ocx} status --json 2>/dev/null | ${jq} -r '.startup.serviceInstalled // false' 2>/dev/null || echo false)"
        if [ "$service_installed" = true ]; then
          if [ "$service_version_skewed" = true ]; then
            if ! ${ocx} service restart; then
              ${ocx} service uninstall
              ${ocx} service install
            fi
          elif ! ${ocx} service repair; then
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
