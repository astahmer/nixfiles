{ inputs, ... }:
{
  config.flake.modules.homeManager.agents =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      executorDir = "${config.home.homeDirectory}/.executor";
      packages = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
      modlens = packages.modlens;
      modsearch = packages.modsearch;
      calldiff = packages.calldiff;
      executorScopeDir = executorDir;
      opencodexConfigTemplate = builtins.fromJSON (
        builtins.readFile ../assets/opencodex/config.template.json
      );
      # Keep ModLens' allowlist aligned with the providers' declared capabilities.
      modlensNoVisionModelIds = lib.unique (
        lib.concatMap (provider: provider.noVisionModels or [ ]) (
          builtins.attrValues opencodexConfigTemplate.providers
        )
      );
      modlensDefaultGuardsJson = builtins.toJSON {
        allowModels = lib.concatMap (model: [
          model
          "*/${model}"
        ]) modlensNoVisionModelIds;
        denyWhenUnknown = true;
      };

      # Exclude deprecated readbro skill from the deployed .agents directory.
      # The source tree itself is kept under assets/ for reference.
      localAgentsFilter =
        path: _type:
        let
          relPath = lib.removePrefix (toString ../assets/.agents) (toString path);
        in
        !(lib.hasPrefix "/skills/readbro" relPath);

      localAgentsSrc = lib.cleanSourceWith {
        src = lib.cleanSource ../assets/.agents;
        filter = localAgentsFilter;
      };

      agentsWithSkillOverlays = pkgs.runCommandLocal "agents-with-skill-overlays" { } ''
        mkdir -p "$out"
        cp -R --no-preserve=mode "${localAgentsSrc}/." "$out/"

        # Portable skills come from the pinned agents source. Keep the local
        # tree as an overlay until every machine-specific skill has moved out
        # of assets/.agents.
        cp -R --no-preserve=mode "${inputs.agents}/.agents/skills/." "$out/skills/"

        # Do not deploy the taste-maintenance skill from the shared agent source.
        rm -rf "$out/skills/taste-from-sessions"

        # emilint owns executable lint assets and their companion guidance.
        mkdir -p "$out/skills/antislop" "$out/skills/effect-antislop"
        cp -R --no-preserve=mode "${inputs.emilint}/ast-grep" "$out/skills/antislop/"
        cp -R --no-preserve=mode "${inputs.emilint}/oxlint" "$out/skills/antislop/"
        cp -R --no-preserve=mode "${inputs.emilint}/tests" "$out/skills/antislop/"
        cp -R --no-preserve=mode "${inputs.emilint}/profiles/effect/ast-grep" "$out/skills/effect-antislop/"
        cp -R --no-preserve=mode "${inputs.emilint}/profiles/effect/oxlint" "$out/skills/effect-antislop/"
        cp -R --no-preserve=mode "${inputs.emilint}/profiles/effect/tests" "$out/skills/effect-antislop/"
        cp "${inputs.emilint}/sgconfig.yml" "$out/skills/antislop/"
        cp "${inputs.emilint}/oxlint.test.config.json" "$out/skills/antislop/"
        cp "${inputs.emilint}/profiles/effect/sgconfig.yml" "$out/skills/effect-antislop/"
        cp "${inputs.emilint}/profiles/effect/oxlint.test.config.json" "$out/skills/effect-antislop/"

        cp "${inputs.emilint}/skills/antislop/SKILL.md" "$out/skills/antislop/"
        cp "${inputs.emilint}/skills/effect-antislop/SKILL.md" "$out/skills/effect-antislop/"
        cp "${inputs.emilint}/CATALOG.md" "$out/skills/antislop/"

        cp -R "${modlens}/share/modlens/skills/modlens" "$out/skills/"
        cp -R "${modsearch}/share/modsearch/skills/modsearch" "$out/skills/"
        cp -R "${calldiff}/share/calldiff/skills/calldiff" "$out/skills/"
      '';

      cursorMcpBase = builtins.fromJSON (builtins.readFile ../assets/.cursor/mcp.json);
      cursorMcp = cursorMcpBase // {
        mcpServers = lib.mapAttrs (
          _: server:
          server
          // {
            env = (server.env or { }) // {
              EXECUTOR_SCOPE_DIR = executorScopeDir;
            };
          }
        ) cursorMcpBase.mcpServers;
      };

      vscodeMcpBase = builtins.fromJSON (builtins.readFile ../assets/vscode/mcp.json);
      vscodeMcp = vscodeMcpBase // {
        servers = lib.mapAttrs (
          _: server:
          server
          // {
            env = (server.env or { }) // {
              EXECUTOR_SCOPE_DIR = executorScopeDir;
            };
          }
        ) vscodeMcpBase.servers;
      };

      opencodeBase = builtins.fromJSON (builtins.readFile ../assets/.config/opencode/opencode.json);
      opencodeConfig = opencodeBase // {
        mcp = lib.mapAttrs (
          _: server:
          server
          // {
            env = (server.env or { }) // {
              EXECUTOR_SCOPE_DIR = executorScopeDir;
            };
          }
        ) opencodeBase.mcp;
      };
      opencodeConfigJson = builtins.toJSON opencodeConfig;
      # Ensure .ts scripts are stored with executable bit so home-manager
      # symlinks them (preserving the .ts extension for --experimental-strip-types)
      # instead of copying them as extensionless regular files.
      mkExecutableFile =
        name: src:
        pkgs.runCommandLocal name {
          inherit src;
          preferLocalBuild = true;
        } "cp $src $out; chmod +x $out";
    in
    {
      home.file.".agents".source = agentsWithSkillOverlays;
      # Codex discovers global instructions from CODEX_HOME/AGENTS.md.
      # Keep the source in the global agent tree while exposing the same
      # content through Codex's machine-local default home.
      home.sessionVariables.CODEX_HOME = "${config.home.homeDirectory}/.codex";
      home.file.".codex/AGENTS.md".source = ../assets/.agents/AGENTS.md;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/rules".source = ../assets/.cursor/rules;
      home.file.".claude/settings.json".source = ../assets/.claude/settings.json;

      home.file.".executor/executor.jsonc".source = ../assets/executor/executor.jsonc;
      home.file.".executor/setup.ts" = {
        source = ../assets/executor/setup.ts;
        executable = true;
      };

      home.file.".cursor/mcp.json".text = builtins.toJSON cursorMcp;
      home.file.".vscode/mcp.json".text = builtins.toJSON vscodeMcp;
      home.file."Library/Application Support/Code/User/mcp.json".text = builtins.toJSON vscodeMcp;

      home.activation.modlensVisionGuard = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        modlens_config_directory="${config.home.homeDirectory}/.modlens"
        modlens_config_file="$modlens_config_directory/config.json"
        modlens_candidate_file="$modlens_config_file.next.$$"
        modlens_default_guards_json=${lib.escapeShellArg modlensDefaultGuardsJson}

        umask 077
        ${pkgs.coreutils}/bin/mkdir -p "$modlens_config_directory"

        if [ -L "$modlens_config_file" ]; then
          echo "modlens: config is symlinked; leaving its guard policy unchanged" >&2
        else
          if [ ! -e "$modlens_config_file" ]; then
            printf '{}\n' > "$modlens_config_file"
          fi

          if ! ${pkgs.jq}/bin/jq empty "$modlens_config_file" > /dev/null 2>&1; then
            echo "modlens: config is invalid JSON; leaving it unchanged" >&2
          elif ${pkgs.jq}/bin/jq --argjson defaults "$modlens_default_guards_json" '
            if .guards == null then .guards = $defaults else . end
          ' "$modlens_config_file" > "$modlens_candidate_file"; then
            ${pkgs.coreutils}/bin/chmod 600 "$modlens_candidate_file"
            if ${pkgs.diffutils}/bin/cmp -s "$modlens_config_file" "$modlens_candidate_file"; then
              ${pkgs.coreutils}/bin/rm -f "$modlens_candidate_file"
            else
              ${pkgs.coreutils}/bin/mv "$modlens_candidate_file" "$modlens_config_file"
              ${pkgs.coreutils}/bin/chmod 600 "$modlens_config_file"
              echo "modlens: seeded a native-vision-safe guard for configured text-only models" >&2
            fi
          else
            ${pkgs.coreutils}/bin/rm -f "$modlens_candidate_file"
            echo "modlens: could not update the guard; preserving the existing config" >&2
          fi
        fi
      '';

      # opencode2 config: use activation script to preserve user edits from app updates
      home.activation.opencode2Config = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                config_file="${config.home.homeDirectory}/.config/opencode/opencode.json"
                candidate_config="$config_file.next.$$"
                current_sorted="$config_file.current.sorted"
                candidate_sorted="$candidate_config.sorted"

                # /usr/bin last: macOS find lacks -printf, which home-manager's
                # own activation steps rely on.
                export PATH="${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${pkgs.jq}/bin:$PATH:/usr/bin:/bin"
                ${pkgs.coreutils}/bin/mkdir -p "${config.home.homeDirectory}/.config/opencode"

                # Write the nix-managed config to a candidate file
                ${pkgs.coreutils}/bin/cat > "$candidate_config" <<'OPENCODE_CONFIG_EOF'
                ${opencodeConfigJson}
        OPENCODE_CONFIG_EOF

                # Only write if config doesn't exist or has changed
                config_changed=0
                if [ ! -f "$config_file" ]; then
                  config_changed=1
                else
                  ${pkgs.jq}/bin/jq -S . "$config_file" > "$current_sorted" 2>/dev/null || config_changed=1
                  ${pkgs.jq}/bin/jq -S . "$candidate_config" > "$candidate_sorted" 2>/dev/null || config_changed=1
                  if [ "$config_changed" -eq 0 ] && ! ${pkgs.diffutils}/bin/cmp -s "$current_sorted" "$candidate_sorted"; then
                    config_changed=1
                  fi
                fi

                if [ "$config_changed" -eq 1 ]; then
                  ${pkgs.coreutils}/bin/cp "$candidate_config" "$config_file"
                  ${pkgs.coreutils}/bin/chmod 600 "$config_file"
                  echo "opencode2: initialized or updated $config_file" >&2
                fi

                ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$current_sorted" "$candidate_sorted"
      '';

      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source = ../assets/.agents/hooks/rtk-rewrite.json;

      home.file.".local/bin/papercuts" = {
        source = mkExecutableFile "hm_papercuts.ts" ../assets/papercuts/papercuts.ts;
        executable = true;
      };

      home.file.".local/bin/cursor" = {
        text = ''
          #!/usr/bin/env bash
          set -euo pipefail
          exec "$HOME/.local/bin/cursor-agent" "$@"
        '';
        executable = true;
      };

      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";

      # readbro is disabled while we use executor as the single integration layer.
      # The package source remains in assets/readbro for now.
    };
}
