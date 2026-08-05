{ inputs, config, ... }:
let
  username = config.nixfiles.username;
in
{
  config.flake.modules.homeManager.coding =
    { pkgs, lib, ... }:
    let
      packages = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
      nub = inputs.nub.packages.${pkgs.stdenv.hostPlatform.system}.default;
      cursorAgent = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}."cursor-agent";
      ghui = packages.ghui;
      agy = packages.agy;
      hunk = packages.hunk;
      lightjj = packages.lightjj;
      modlens = packages.modlens;
      modsearch = packages.modsearch;
      plannotator = packages.plannotator;
      codex = packages.codex;
      opencode = packages.opencode;
    in
    {
      home.packages = [
        pkgs."google-chrome"
        pkgs.bat
        pkgs.gh
        pkgs."github-copilot-cli"
        cursorAgent
        codex
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
        agy
        modlens
        modsearch
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
        opencode
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
