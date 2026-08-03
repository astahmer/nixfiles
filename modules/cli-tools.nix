{ ... }:
{
  config.flake.modules.homeManager.cliTools =
    {
      pkgs,
      config,
      ...
    }:
    let
      # Not under xdg "nixfiles/" — that path is the flake clone symlink (NH_FLAKE).
      overviewPath = "${config.xdg.configHome}/cli-tools/overview.html";
      cliTools = pkgs.writeShellApplication {
        name = "cli-tools";
        text = builtins.replaceStrings [ "@overview@" ] [ overviewPath ] (
          builtins.readFile ../assets/cli-tools/cli-tools.sh
        );
      };
    in
    {
      home.packages = [ cliTools ];
      xdg.configFile."cli-tools/overview.html".source = ../assets/cli-tools/overview.html;
    };
}
