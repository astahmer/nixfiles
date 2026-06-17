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
      readbro = import ../readbro-package.nix { inherit pkgs; };
      readbroBin = "${readbro}/bin/readbro";
      githubTokenFile = "${config.home.homeDirectory}/.config/opencode/github-token";

      cursorMcpBase = builtins.fromJSON (builtins.readFile ../assets/.cursor/mcp.json);
      cursorMcp = cursorMcpBase // {
        mcpServers = cursorMcpBase.mcpServers // {
          readbro = {
            command = readbroBin;
          };
        };
      };

      vscodeMcpBase = builtins.fromJSON (builtins.readFile ../assets/vscode/mcp.json);
      vscodeMcp = vscodeMcpBase // {
        servers = vscodeMcpBase.servers // {
          readbro = (vscodeMcpBase.servers.readbro or { }) // {
            command = readbroBin;
          };
        };
      };

      opencodeBase = builtins.fromJSON (builtins.readFile ../assets/.config/opencode/opencode.json);
      opencodeConfig = opencodeBase // {
        mcp = opencodeBase.mcp // {
          readbro = (opencodeBase.mcp.readbro or { }) // {
            command = [ readbroBin ];
          };
        };
      };

      withGithubTokenFile = text:
        builtins.replaceStrings
          [ "Bearer {env:GITHUB_TOKEN}" ]
          [ "Bearer {file:${githubTokenFile}}" ]
          text;
    in
    {
      home.packages = [ readbro ];

      home.file.".agents".source = ../assets/.agents;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/hooks/caveman-thinking.sh" = {
        source = ../assets/.cursor/hooks/caveman-thinking.sh;
        executable = true;
      };
      home.file.".cursor/rules".source = ../assets/.cursor/rules;
      home.file.".claude/settings.json".source = ../assets/.claude/settings.json;

      home.file.".cursor/mcp.json".text = withGithubTokenFile (builtins.toJSON cursorMcp);
      home.file.".vscode/mcp.json".text = builtins.toJSON vscodeMcp;
      home.file."Library/Application Support/Code/User/mcp.json".text = builtins.toJSON vscodeMcp;
      home.file.".config/opencode/opencode.json".text =
        withGithubTokenFile (builtins.toJSON opencodeConfig);

      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source = ../assets/.agents/hooks/rtk-rewrite.json;

      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";
    };
}
