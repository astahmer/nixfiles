{ inputs, config, ... }:
let
  darwin = config.flake.modules.darwin;
in
{
  config.flake.darwinConfigurations.${config.flake.darwinHostName} = inputs.darwin.lib.darwinSystem {
    system = config.flake.darwinSystem;
    specialArgs = { inherit inputs; };

    modules = [
      darwin.base
      darwin.homebrew
      darwin.homeManager

      {
        networking.hostName = config.flake.darwinHostName;
      }
    ];
  };
}