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
        current_sorted="$config_file.current.sorted"
        candidate_sorted="$candidate_config.sorted"

        export PATH="${pkgs.bun}/bin:${pkgs.coreutils}/bin:${pkgs.jq}/bin:/usr/bin:/bin"
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

        # Keep the runtime-owned account metadata and credentials, while
        # reconciling provider/routing defaults from the Nix template. The
        # account selectors intentionally use public labels; the work target
        # is discovered from the first non-main Codex pool account at runtime.
        if [ -f "$config_file" ]; then
          ${jq} -s '
            .[0] as $current
            | .[1] as $desired
            | ($current.providers // {}) as $currentProviders
            | ($currentProviders["opencode-go"] // null) as $legacyOpenCode
            | (if (($currentProviders | has("opencode")) | not) and ($legacyOpenCode != null)
               then ($current | .providers.opencode = $legacyOpenCode)
               else $current
               end) as $base
            | ($base * $desired)
            | del(.providers["opencode-go"])
            | del(.providers.commandcode.disabled)
            | (($base.codexAccounts // [])
               | map(select(.isMain != true and (.id | type == "string")) | .id)
               | .[0]) as $work
            | .codexAccountNamespaces = (
                (($base.codexAccountNamespaces // {}) * (.codexAccountNamespaces // {}))
                + {"codex-perso": "@main"}
                + (if $work != null
                   then {"codex-work": $work}
                   else {}
                   end)
              )
            | .pausedCodexAccountIds = ((.pausedCodexAccountIds // []) - ["__main__"])
            | .providers.commandcode.apiKey = (
                if (env.OPENCODEX_COMMANDCODE_API_KEY // "") != ""
                then env.OPENCODEX_COMMANDCODE_API_KEY
                elif (($base.providers.commandcode.apiKey? // "") == "replace-me"
                      or ($base.providers.commandcode.apiKey? // "") == "")
                then .providers.commandcode.apiKey
                else ($base.providers.commandcode.apiKey? // .providers.commandcode.apiKey)
                end
              )
            | .providers.commandcode.apiKeyPool[0].key = (
                if (env.OPENCODEX_COMMANDCODE_API_KEY // "") != ""
                then env.OPENCODEX_COMMANDCODE_API_KEY
                elif ((($base.providers.commandcode.apiKeyPool // [])[0].key? // "") == "replace-me"
                      or (($base.providers.commandcode.apiKeyPool // [])[0].key? // "") == "")
                then .providers.commandcode.apiKeyPool[0].key
                else (($base.providers.commandcode.apiKeyPool // [])[0].key? // .providers.commandcode.apiKeyPool[0].key)
                end
              )
            | .providers.opencode.apiKey = (
                if (env.OPENCODEX_OPENCODE_GO_API_KEY // "") != ""
                then env.OPENCODEX_OPENCODE_GO_API_KEY
                elif (($base.providers.opencode.apiKey? // "") == "replace-me"
                      or ($base.providers.opencode.apiKey? // "") == "")
                then .providers.opencode.apiKey
                else ($base.providers.opencode.apiKey? // .providers.opencode.apiKey)
                end
              )
            | .providers.opencode.apiKeyPool[0].key = (
                if (env.OPENCODEX_OPENCODE_GO_API_KEY // "") != ""
                then env.OPENCODEX_OPENCODE_GO_API_KEY
                elif ((($base.providers.opencode.apiKeyPool // [])[0].key? // "") == "replace-me"
                      or (($base.providers.opencode.apiKeyPool // [])[0].key? // "") == "")
                then .providers.opencode.apiKeyPool[0].key
                else (($base.providers.opencode.apiKeyPool // [])[0].key? // .providers.opencode.apiKeyPool[0].key)
                end
              )
          ' "$config_file" "$config_template" > "$candidate_config"
        else
          ${jq} '
            .codexAccountNamespaces = {"codex-perso": "@main"}
          ' "$config_template" > "$candidate_config"
        fi

        ${ocx} config validate "$candidate_config" --json > /dev/null
        ${jq} -S . "$candidate_config" > "$candidate_sorted"

        config_changed=0
        if [ ! -f "$config_file" ]; then
          config_changed=1
        else
          ${jq} -S . "$config_file" > "$current_sorted"
          if ! ${pkgs.coreutils}/bin/cmp -s "$current_sorted" "$candidate_sorted"; then
            config_changed=1
          fi
        fi

        if [ "$config_changed" -eq 1 ]; then
          ${ocx} config import "$candidate_config" --yes --json > /dev/null
          ${pkgs.coreutils}/bin/chmod 600 "$config_file"
          echo "opencodex: reconciled $config_file from the Nix template" >&2
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$current_sorted" "$candidate_sorted"

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
