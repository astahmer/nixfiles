{ ... }:
{
  config.flake.modules.homeManager.agents =
    { config, lib, ... }:
    {
      home.file.".agents".source = ../assets/.agents;

      home.activation.linkCopilotSkills = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        mkdir -p "${config.home.homeDirectory}/.copilot"
        ln -sfn "${config.home.homeDirectory}/.agents/skills" "${config.home.homeDirectory}/.copilot/skills"
      '';
    };
}
