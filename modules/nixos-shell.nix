flakeConfig@{ ... }:
{
  config.flake.modules.homeManager.nixosShell =
    { config, ... }:
    {
      home.shellAliases.nixos-switch = "sudo nixos-rebuild switch --flake ${config.home.homeDirectory}/dev/alex/nixfiles#${flakeConfig.flake.nixosHostName}";
    };
}
