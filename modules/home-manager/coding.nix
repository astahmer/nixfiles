{
  config,
  ...
}:
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs."google-chrome"
        pkgs.gh
        pkgs.jq
        pkgs.neovim
        pkgs.nixd
        pkgs.nixfmt
        pkgs.tmux
        pkgs.vscode
        pkgs.fnm
        pkgs.curl
        pkgs.ripgrep
        pkgs.uv
        pkgs.qdirstat
        pkgs.htop
        pkgs.devenv
        pkgs."docker-compose"
      ];
    };
}
