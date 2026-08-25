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
      vscodeTasksToZed = pkgs.writeShellApplication {
        name = "vscode-tasks-to-zed";
        runtimeInputs = [ pkgs.bun ];
        text = ''
          exec bun "${config.xdg.configHome}/cli-tools/vscode-tasks-to-zed.mjs" "$@"
        '';
      };
    in
    {
      home.packages = [
        cliTools
        vscodeTasksToZed
      ];
      xdg.configFile."cli-tools/overview.html".source = ../assets/cli-tools/overview.html;
      xdg.configFile."cli-tools/vscode-tasks-to-zed.mjs".source = ../assets/cli-tools/vscode-tasks-to-zed.mjs;
    };
}
