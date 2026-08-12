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

        if [ ! -f "$secrets_file" ] && [ -f "$example_file" ]; then
          ${pkgs.coreutils}/bin/cp "$example_file" "$secrets_file"
          ${pkgs.coreutils}/bin/chmod 600 "$secrets_file"
          echo "opencodex: created $secrets_file (fill in API keys)" >&2
        fi

        # Read only the two known dotenv assignments. Do not source the file:
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
              export\ OPENCODEX_COMMANDCODE_API_KEY=*)
                secret_name="OPENCODEX_COMMANDCODE_API_KEY"
                secret_value="''${line#export OPENCODEX_COMMANDCODE_API_KEY=}"
                ;;
              export\ OPENCODEX_OPENCODE_GO_API_KEY=*)
                secret_name="OPENCODEX_OPENCODE_GO_API_KEY"
                secret_value="''${line#export OPENCODEX_OPENCODE_GO_API_KEY=}"
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

        # Use the template only for first-run defaults. Once a config exists,
        # its values win so dashboard and `ocx` edits remain user-owned. Nix
        # still performs the small compatibility/key/selector migrations below.
        if [ -f "$config_file" ]; then
          ${jq} '
            . as $current
            | ($current.providers // {}) as $currentProviders
            | ($currentProviders["opencode-go"] // null) as $legacyOpenCode
            | (if (($currentProviders | has("opencode")) | not) and ($legacyOpenCode != null)
               then ($current | .providers.opencode = $legacyOpenCode)
               else $current
               end) as $base
            | $base
            | del(.providers["opencode-go"])
            | del(.providers.commandcode.disabled)
            | (($base.codexAccounts // [])
               | map(select(.isMain != true and (.id | type == "string")) | .id)
            ) as $workIds
            | ($workIds | .[0]) as $work
            | (($base.codexAccountNamespaces // {}) + {"codex-perso": "@main"}) as $namespaces
            | .codexAccountNamespaces = (
                if (($namespaces["codex-work"] // "") as $selected
                    | ($workIds | index($selected)) != null)
                then $namespaces
                elif $work != null
                then ($namespaces + {"codex-work": $work})
                else ($namespaces | del(."codex-work"))
                end
              )
          ' "$config_file" > "$candidate_config"
        else
          ${jq} '
            .codexAccountNamespaces = {"codex-perso": "@main"}
          ' "$config_template" > "$candidate_config"
        fi

        # Materialize configured secrets only for providers that exist. With
        # no secret value, keep the user's existing key fields exactly as-is.
        ${jq} '
          if (env.OPENCODEX_COMMANDCODE_API_KEY // "") != ""
             and ((.providers // {}) | has("commandcode"))
          then .providers.commandcode.apiKey = env.OPENCODEX_COMMANDCODE_API_KEY
             | .providers.commandcode.apiKeyPool[0].key = env.OPENCODEX_COMMANDCODE_API_KEY
          else .
          end
          | if (env.OPENCODEX_OPENCODE_GO_API_KEY // "") != ""
               and ((.providers // {}) | has("opencode"))
            then .providers.opencode.apiKey = env.OPENCODEX_OPENCODE_GO_API_KEY
               | .providers.opencode.apiKeyPool[0].key = env.OPENCODEX_OPENCODE_GO_API_KEY
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
