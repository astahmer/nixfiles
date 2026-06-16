{ ... }:
{
  config.flake.modules.homeManager.agents =
    { ... }:
    {
      home.file.".agents".source = ../assets/.agents;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;

      # VS Code / Copilot default user-profile paths (also mirrored under ~/.agents/).
      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source =
        ../assets/.agents/hooks/rtk-rewrite.json;
      home.file.".copilot/hooks/composto-rewrite.json".source =
        ../assets/.agents/hooks/composto-rewrite.json;
    };
}
