{ inputs, config, ... }:
let
  hm = config.flake.modules.homeManager;
  username = config.flake.username;
in
{
  config.flake.homeConfigurations.${config.flake.linuxHomeName} =
    inputs.home-manager.lib.homeManagerConfiguration
      {
        pkgs = import inputs.nixpkgs {
          system = config.flake.linuxSystem;
          config.allowUnfree = true;
        };

        extraSpecialArgs = { inherit inputs; };

        modules = [
          inputs.nix-index-database.homeModules.default
          hm.base
          hm.terminal
          hm.shell
          hm.git
          hm.jujutsu
          hm.coding
          hm.vscode
          hm.agents
          hm.tools
          hm.launcher
          hm.linuxApps
          hm.work

          (
            { ... }:
            {
              home.homeDirectory = "/home/${username}";
              home.username = username;
              targets.genericLinux.enable = true;
            }
          )
        ];
      };
}
