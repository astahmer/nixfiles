{ config, ... }:
let
  username = config.flake.username;
in
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    {
      home.packages = [
        pkgs."google-chrome"
        pkgs.gh
        pkgs.comma
        pkgs.deadnix
        pkgs."jj-starship"
        pkgs.jq
        pkgs.neovim
        pkgs.nixd
        pkgs.nixfmt
        pkgs.tmux
        pkgs.vscode
        pkgs.zed-editor
        pkgs.fnm
        pkgs.curl
        pkgs.ripgrep
        pkgs.uv
        pkgs.htop
        pkgs.devenv
      ];
    };

  config.flake.modules.nixos.coding =
    { ... }:
    {
      programs.nix-ld.enable = true;

      virtualisation.docker = {
        enable = true;
        autoPrune.enable = true;
      };

      users.users.${username}.extraGroups = [ "docker" ];
    };
}
