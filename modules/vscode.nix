{ ... }:
{
  config.flake.modules.homeManager.vscode =
    { lib, pkgs, ... }:
    let
      settingsJson = builtins.readFile ../assets/vscode/settings.jsonc;
      settingsWithNixd = builtins.replaceStrings
        [ "\"nix.serverPath\": \"nixd\"" ]
        [ "\"nix.serverPath\": \"${lib.getExe pkgs.nixd}\"" ]
        settingsJson;
      settingsWithNixfmt = builtins.replaceStrings
        [ "\"nixfmt\"" ]
        [ "\"${lib.getExe pkgs.nixfmt}\"" ]
        settingsWithNixd;
    in
    {
      home.packages = [ pkgs.vscode ];

      home.file = lib.mkMerge [
        (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
          "Library/Application Support/Code/User/settings.json".text = settingsWithNixfmt;
        })
        (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
          ".config/Code/User/settings.json".text = settingsWithNixfmt;
        })
      ];
    };
}
