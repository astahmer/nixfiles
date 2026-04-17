{ config, ... }:
let
  username = config.flake.username;
in
{
  config.flake.modules.nixos.coding =
    { ... }:
    {
      programs.nix-ld.enable = true;

      virtualisation.docker = {
        enable = true;
        autoPrune.enable = true;
      };

      users.users.${username}.extraGroups = [ "docker" ];
    };
}
