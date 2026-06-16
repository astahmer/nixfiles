{ ... }:
{
  config.flake.modules.homeManager.agents =
    { config, ... }:
    {
      home.file.".agents".source = ../assets/.agents;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/rules".source = ../assets/.cursor/rules;
      home.file.".claude/settings.json".source = ../assets/.claude/settings.json;
      home.file.".config/caveman/config.json".source = ../assets/.config/caveman/config.json;

      home.sessionVariables.CAVEMAN_DEFAULT_MODE = "full";

      # VS Code / Copilot default user-profile paths (mirrored under ~/.agents/).
      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source =
        ../assets/.agents/hooks/rtk-rewrite.json;
      home.file.".copilot/hooks/composto-rewrite.json".source =
        ../assets/.agents/hooks/composto-rewrite.json;

      # Copilot/VS Code default skills path → same tree as ~/.agents/skills.
      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";
    };
}
