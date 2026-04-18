{
  config,
  ...
}:
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        google-chrome
        gh
        jq
        neovim
        nixd
        nixfmt
        tmux
        vscode
        fnm
        curl
        ripgrep
        uv
        qdirstat
        htop
        devenv
        docker-compose
      ];
    };
}
