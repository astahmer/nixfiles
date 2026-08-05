{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
in
{
  config.flake.nixosConfigurations.${config.nixfiles.nixosHostName} = inputs.nixpkgs.lib.nixosSystem {
    system = config.nixfiles.nixosSystem;
    specialArgs = { inherit inputs; };

    modules = [
      inputs.home-manager.nixosModules.home-manager
      nixos.base
      nixos.coding
      nixos.ryu
      nixos.drydock
      nixos.opencodex
      nixos.sunshine
      nixos.homeManager

      {
        networking.hostName = config.nixfiles.nixosHostName;
        fileSystems."/" = {
          device = "/dev/disk/by-label/nixos";
          fsType = "ext4";
        };
      }
    ];
  };
}
