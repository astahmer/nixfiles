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
          config = {
            allowUnfree = true;
            # Beekeeper Studio 6.1.1 bundles EOL Electron 39.8.1 with known CVEs;
            # permit only this exact version until it ships a supported runtime.
            permittedInsecurePackages = [ "beekeeper-studio-6.1.1" ];
          };
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
          hm.codexConfig
          hm.tokitoki
          hm.tokitokiBbPlugin
          hm.t3code
          hm.bbPlugins
          hm.aiAccounts
          hm.coding
          hm.zed
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
          hm.shiftshift
          hm.macosApps
          hm.raycastLocalExtensions

          (
            { ... }:
            {
              home.homeDirectory = "/Users/${username}";
              home.username = username;

              # macosApps owns explicit copies in ~/Applications; keep the
              # native copier disabled because GUI packages stay out of the
              # profile to avoid duplicate app discovery.
              targets.darwin.copyApps.enable = false;
            }
          )
        ];
      };
}
