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

      # Exclude deprecated readbro skill from the deployed .agents directory.
      # The source tree itself is kept under assets/ for reference.
      agentsFilter =
        path: _type:
        let
          relPath = lib.removePrefix (toString ../assets/.agents) (toString path);
        in
        !(lib.hasPrefix "/skills/readbro" relPath);

      agentsSrc = lib.cleanSourceWith {
        src = lib.cleanSource ../assets/.agents;
        filter = agentsFilter;
      };

      agentsWithSkillOverlays = pkgs.runCommandLocal "agents-with-skill-overlays" { } ''
        mkdir -p "$out"
        cp -R --no-preserve=mode "${agentsSrc}/." "$out/"
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

      # opencode2 config: use activation script to preserve user edits from app updates
      home.activation.opencode2Config = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                config_file="${config.home.homeDirectory}/.config/opencode/opencode.json"
                candidate_config="$config_file.next.$$"
                current_sorted="$config_file.current.sorted"
                candidate_sorted="$candidate_config.sorted"

                export PATH="${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${pkgs.jq}/bin:/usr/bin:/bin"
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

      home.file.".local/bin/antislop" = {
        source = mkExecutableFile "hm_antislop.ts" ../assets/antislop/antislop.ts;
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
