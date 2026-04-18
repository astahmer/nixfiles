{ inputs, config, ... }:
let
  nixos = config.flake.modules.nixos;
in
{
  config.flake.nixosConfigurations.${config.flake.nixosHostName} = inputs.nixpkgs.lib.nixosSystem {
    system = config.flake.nixosSystem;
    specialArgs = { inherit inputs; };

    modules = [
      nixos.base
      nixos.coding
      nixos.sunshine
      nixos.homeManager

      {
        networking.hostName = config.flake.nixosHostName;
      }
    ];
  };
}
