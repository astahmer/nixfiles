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
      pkgDir = "${config.home.homeDirectory}/.local/share/readbro";
    in
    {
      home.file.".agents".source = ../assets/.agents;
      home.file.".cursor/hooks.json".source = ../assets/.cursor/hooks.json;
      home.file.".cursor/rules".source = ../assets/.cursor/rules;
      home.file.".claude/settings.json".source = ../assets/.claude/settings.json;
      home.file.".local/share/readbro".source = ../assets/readbro;

      home.file.".local/share/pnpm/readbro" = {
        text = ''
          #!${pkgs.bash}/bin/bash
          exec ${pkgs.nodejs_24}/bin/node "${pkgDir}/src/serve.mjs" "$@"
        '';
        executable = true;
      };

      home.activation.readbroDeps = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ ! -d "${pkgDir}/node_modules" ]; then
          $DRY_RUN_CMD (cd "${pkgDir}" && ${pkgs.nodejs_24}/bin/npm install --omit=dev) || true
        fi
      '';

      home.file.".copilot/instructions/copilot.instructions.md".source =
        ../assets/.agents/instructions/copilot.instructions.md;
      home.file.".copilot/hooks/rtk-rewrite.json".source = ../assets/.agents/hooks/rtk-rewrite.json;

      home.file.".copilot/skills".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/skills";
    };
}
