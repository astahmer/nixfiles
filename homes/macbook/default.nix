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
      hm.shell
      hm.git
      hm.jujutsu
      hm.coding
      hm.agents
      hm.tools
      hm.macosApps

      ({ pkgs, lib, ... }:
        lib.mkMerge [
          {
            home.homeDirectory = "/Users/${username}";
            home.username = username;
          }

          # Temporary: on Darwin, avoid evaluating any contributed
          # `home.packages` from other modules so evaluation doesn't
          # attempt to build Linux-only packages. Remove this once
          # modules are properly guarded.
          (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
            home.packages = [];
          })
        ])
    ];
  };
}
