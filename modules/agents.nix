{ ... }:
{
  config.flake.modules.homeManager.agents =
    { config, pkgs, lib, ... }:
    let
      pkgDir = "${config.home.homeDirectory}/.local/share/composto-cachebro";
    in
    {
      home.file.".agents".source = ../assets/.agents;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/rules".source = ../assets/.cursor/rules;
      home.file.".claude/settings.json".source = ../assets/.claude/settings.json;
      home.file.".config/caveman/config.json".source = ../assets/.config/caveman/config.json;
      home.file.".local/share/composto-cachebro".source = ../assets/composto-cachebro;

      home.file.".local/share/pnpm/composto-cachebro" = {
        text = ''
          #!${pkgs.bash}/bin/bash
          exec ${pkgs.nodejs_24}/bin/node "${pkgDir}/src/serve.mjs" "$@"
        '';
        executable = true;
      };

      home.activation.compostoCachebroDeps = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ ! -d "${pkgDir}/node_modules" ]; then
          $DRY_RUN_CMD (cd "${pkgDir}" && ${pkgs.nodejs_24}/bin/npm install --omit=dev) || true
        fi
      '';

      home.sessionVariables.CAVEMAN_DEFAULT_MODE = "full";

      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source =
        ../assets/.agents/hooks/rtk-rewrite.json;
      home.file.".copilot/hooks/composto-rewrite.json".source =
        ../assets/.agents/hooks/composto-rewrite.json;

      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";
    };
}
