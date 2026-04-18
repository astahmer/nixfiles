{ inputs, config, ... }:
let
  username = config.flake.username;
  hm = config.flake.modules.homeManager;
in
{
  config.flake.modules.darwin.homeManager =
    { ... }:
    {
      imports = [ inputs.home-manager.darwinModules.home-manager ];

      home-manager = {
        backupFileExtension = "hm-backup";
        extraSpecialArgs = { inherit inputs; };
        useGlobalPkgs = true;
        useUserPackages = true;

        users.${username} = {
          home.homeDirectory = "/Users/${username}";
          home.username = username;

          imports = [
            hm.base
            hm.terminal
            hm.git
            hm.coding
            hm.tools
          ];
        };
      };
    };
}