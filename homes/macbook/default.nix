{ inputs, config, ... }:
let
  hm = config.flake.modules.homeManager;
  username = config.flake.username;
in
{
  config.flake.homeConfigurations.${config.flake.macHomeName} = inputs.home-manager.lib.homeManagerConfiguration {
    pkgs = import inputs.nixpkgs {
      system = config.flake.macSystem;
      config.allowUnfree = true;
    };

    extraSpecialArgs = { inherit inputs; };

    modules = [
      hm.base
      hm.terminal
      hm.git
      hm.coding

      {
        home.homeDirectory = "/Users/${username}";
        home.username = username;
      }
    ];
  };
}
