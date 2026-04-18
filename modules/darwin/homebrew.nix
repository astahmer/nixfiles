{ inputs, config, ... }:
{
  config.flake.modules.darwin.homebrew =
    { ... }:
    {
      imports = [
        inputs.nix-homebrew.darwinModules.nix-homebrew
        config.flake.modules.darwin.communication
        config.flake.modules.darwin.design
      ];

      nix-homebrew = {
        enable = true;
        enableRosetta = true;
        autoMigrate = true;
        mutableTaps = false;
        user = config.flake.username;
        taps = {
          "homebrew/homebrew-core" = inputs.homebrew-core;
          "homebrew/homebrew-cask" = inputs.homebrew-cask;
        };
      };

      homebrew = {
        enable = true;
        casks = [ "orbstack" ];
        taps = builtins.attrNames config.nix-homebrew.taps;
      };
    };
}