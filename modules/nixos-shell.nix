{ config, ... }:
{
  config.flake.modules.homeManager.nixosShell =
    homeConfig@{ ... }:
    {
      home.shellAliases.nixos-switch = "sudo nixos-rebuild switch --flake ${homeConfig.config.home.homeDirectory}/dev/alex/nixfiles#${config.flake.nixosHostName}";
    };
}
