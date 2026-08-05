{ config, ... }:
{
  config.flake.modules.homeManager.nixosShell =
    { ... }:
    {
      # NH_FLAKE is ~/.config/nixfiles (symlink to clone). Same on every machine.
      home.shellAliases.nixos-switch = "sudo nixos-rebuild switch --flake \"$NH_FLAKE#${config.nixfiles.nixosHostName}\"";
    };
}
