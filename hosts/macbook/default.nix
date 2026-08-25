{ inputs, config, ... }:
let
  hm = config.flake.modules.homeManager;
  username = config.nixfiles.username;
in
{
  config.flake.homeConfigurations.${config.nixfiles.macHomeName} =
    inputs.home-manager.lib.homeManagerConfiguration
      {
        pkgs = import inputs.nixpkgs {
          system = config.nixfiles.macSystem;
          config.allowUnfree = true;
        };

        extraSpecialArgs = { inherit inputs; };

        modules = [
          inputs.nix-index-database.homeModules.default
          hm.base
          hm.terminal
          hm.shell
          hm.bitwarden
          hm.herdrRemote
          hm.ssh
          hm.git
          hm.jujutsu
          hm.ryu
          hm.drydock
          hm.opencodex
          hm.t3code
          hm.coding
          hm.vscode
          hm.agents
          hm.pi
          hm.tools
          hm.cliTools
          hm.work
          hm.iris
          (
            { pkgs, ... }:
            {
              home.packages = [ pkgs."karabiner-elements" ];

              home.file.".config/karabiner/karabiner.json".source = ./karabiner.json;
            }
          )
          hm.macosApps
          hm.raycastLocalExtensions

          (
            { ... }:
            {
              home.homeDirectory = "/Users/${username}";
              home.username = username;

              # Keep existing copied app bundles untouched. Updating them
              # requires macOS App Management permission; CLI tools do not.
              targets.darwin.copyApps.enable = false;
            }
          )
        ];
      };
}
