{ ... }:
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
      executorScopeDir = executorDir;
      githubTokenFile = "${config.home.homeDirectory}/.config/opencode/github-token";

      # Exclude deprecated readbro skill from the deployed .agents directory.
      # The source tree itself is kept under assets/ for reference.
      agentsFilter = path: type:
        let
          relPath = lib.removePrefix (toString ../assets/.agents) (toString path);
        in
        !(lib.hasPrefix "/skills/readbro" relPath);

      agentsSrc = lib.cleanSourceWith {
        src = lib.cleanSource ../assets/.agents;
        filter = agentsFilter;
      };

      cursorMcpBase = builtins.fromJSON (builtins.readFile ../assets/.cursor/mcp.json);
      cursorMcp = cursorMcpBase // {
        mcpServers = lib.mapAttrs (_: server: server // {
          env = (server.env or { }) // {
            EXECUTOR_SCOPE_DIR = executorScopeDir;
          };
        }) cursorMcpBase.mcpServers;
      };

      vscodeMcpBase = builtins.fromJSON (builtins.readFile ../assets/vscode/mcp.json);
      vscodeMcp = vscodeMcpBase // {
        servers = lib.mapAttrs (_: server: server // {
          env = (server.env or { }) // {
            EXECUTOR_SCOPE_DIR = executorScopeDir;
          };
        }) vscodeMcpBase.servers;
      };

      opencodeBase = builtins.fromJSON (builtins.readFile ../assets/.config/opencode/opencode.json);
      opencodeConfig = opencodeBase // {
        mcp = lib.mapAttrs (_: server: server // {
          env = (server.env or { }) // {
            EXECUTOR_SCOPE_DIR = executorScopeDir;
          };
        }) opencodeBase.mcp;
      };
    in
    {
      home.file.".agents".source = agentsSrc;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/hooks/caveman-thinking.sh" = {
        source = ../assets/.cursor/hooks/caveman-thinking.sh;
        executable = true;
      };
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
      home.file.".config/opencode/opencode.json".text = builtins.toJSON opencodeConfig;

      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source = ../assets/.agents/hooks/rtk-rewrite.json;

      home.file.".local/bin/papercuts" = {
        source = ../assets/papercuts/papercuts.ts;
        executable = true;
      };

      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";

      # readbro is disabled while we use executor as the single integration layer.
      # The package source remains in assets/readbro for now.
    };
}
