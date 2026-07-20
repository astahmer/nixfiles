{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
in
{
  config.flake.nixosConfigurations.${config.flake.nixosHostName} = inputs.nixpkgs.lib.nixosSystem {
    system = config.flake.nixosSystem;
    specialArgs = { inherit inputs; };

    modules = [
      inputs.home-manager.nixosModules.home-manager
      nixos.base
      nixos.coding
      nixos.ryu
      nixos.opencodex
      nixos.sunshine
      nixos.homeManager

      {
        networking.hostName = config.flake.nixosHostName;
        fileSystems."/" = {
          device = "/dev/disk/by-label/nixos";
          fsType = "ext4";
        };
      }
    ];
  };
}
