{ config, ... }:
{
  config.flake.modules.homeManager.agents =
    { ... }:
    {
      home.file.".agents".source = ../assets/.agents;
    };
}
