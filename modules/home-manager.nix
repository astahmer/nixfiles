{ inputs, config, ... }:
let
  username = config.flake.username;
  hm = config.flake.modules.homeManager;
in
{
  config.flake.modules.nixos.homeManager =
    { ... }:
    {
      home-manager = {
        backupFileExtension = "hm-backup";
        extraSpecialArgs = { inherit inputs; };
        useGlobalPkgs = true;
        useUserPackages = true;

        users.${username} = {
          home.homeDirectory = "/home/${username}";
          home.username = username;

          imports = [
            inputs.nix-index-database.homeModules.default
            hm.base
            hm.terminal
            hm.shell
            hm.git
            hm.jujutsu
            hm.coding
            hm.agents
            hm.linuxApps
            hm.tools
            hm.launcher
            hm.nixosShell
          ];
        };
      };
    };
}
