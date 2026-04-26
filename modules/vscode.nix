{ ... }:
{
  config.flake.modules.homeManager.vscode =
    { pkgs, ... }:
    {
      home.packages = [ pkgs.vscode ];
    };
}
