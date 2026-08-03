{ inputs, config, ... }:
let
  username = config.flake.username;
in
{
  config.flake.modules.homeManager.coding =
    { pkgs, lib, ... }:
    let
      ghui = import ../packages/ghui.nix { inherit pkgs; };
      hunk = import ../packages/hunk.nix { inherit pkgs; };
      lightjj = import ../packages/lightjj.nix { inherit pkgs; };
      nub = inputs.nub.packages.${pkgs.stdenv.hostPlatform.system}.default;
      plannotator = import ../packages/plannotator.nix { inherit pkgs; };
    in
    {
      home.packages = [
        pkgs."google-chrome"
        pkgs.bat
        pkgs.gh
        pkgs."github-copilot-cli"
        plannotator
        pkgs.comma
        pkgs.delta
        hunk
        pkgs.deadnix
        pkgs.ffmpeg
        pkgs.fzf
        pkgs.hyperfine
        pkgs.fresh-editor
        lightjj
        pkgs."jj-starship"
        pkgs.jq
        pkgs.httpie
        pkgs.ncdu
        pkgs.pik
        pkgs.neovim
        pkgs.nixd
        pkgs.nixfmt
        nub
        pkgs.tokei
        pkgs.tmux
        pkgs.tree
        # Temporarily disabled while Zed is not in use.
        # zed
        pkgs.curl
        pkgs.ripgrep
        pkgs.ripdrag
        pkgs."yt-dlp"
        pkgs.uv
        pkgs.opencode
        pkgs.htop
        pkgs.btop
        pkgs.devenv
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
        pkgs.bun
        ghui
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
        pkgs.docker
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
