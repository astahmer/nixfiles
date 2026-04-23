{ ... }:
{
  config.flake.modules.homeManager.vscode =
    { lib, pkgs, ... }:
    {
      home.packages = [ pkgs.vscode ];

      home.file = lib.mkMerge [
        (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
          "Library/Application Support/Code/User/settings.json".source = ../assets/vscode/settings.jsonc;
        })
        (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
          ".config/Code/User/settings.json".source = ../assets/vscode/settings.jsonc;
        })
      ];
    };
}
