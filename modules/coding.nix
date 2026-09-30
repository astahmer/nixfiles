{ inputs, config, ... }:
let
  username = config.nixfiles.username;
in
{
  config.flake.modules.homeManager.coding =
    { pkgs, lib, ... }:
    let
      packages = inputs.self.packages.${pkgs.stdenv.hostPlatform.system};
      calldiff = packages.calldiff;
      devenv = packages.devenv;
      nub = packages.nub;
      cursorAgent = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}."cursor-agent";
      ghui = packages.ghui;
      hunk = packages.hunk;
      jjw = packages.jjw;
      lightjj = packages.lightjj;
      plannotator = packages.plannotator;
      codex = packages.codex;
      opencode = inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.opencode;
      opencode2 = packages.opencode2;
      agent = pkgs.writeShellScriptBin "agent" ''
        exec ${lib.getExe cursorAgent} "$@"
      '';
      pi-watchdog = packages.pi-watchdog;
      qmd = inputs.qmd.packages.${pkgs.stdenv.hostPlatform.system}.default;
      zed = packages.zed;
    in
    {
      home.packages = [
        pkgs.bat
        pkgs.gh
        pkgs."github-copilot-cli"
        cursorAgent
        agent
        codex
        plannotator
        pkgs.comma
        pkgs.delta
        pkgs."ast-grep"
        hunk
        jjw
        pkgs.deadnix
        pkgs.ffmpeg
        pkgs.fzf
        pkgs.hyperfine
        pkgs.fresh-editor
        lightjj
        calldiff
        pkgs."jj-starship"
        pkgs.jq
        pkgs.httpie
        pkgs.ncdu
        pkgs.pik
        pkgs.neovim
        pkgs.nixd
        pkgs.nixfmt
        pkgs.oxlint
        nub
        pi-watchdog
        qmd
        pkgs.tokei
        pkgs.tmux
        pkgs.tree
        pkgs.curl
        pkgs.ripgrep
        pkgs.ripdrag
        pkgs."yt-dlp"
        pkgs.uv
        opencode
        opencode2
        pkgs.htop
        pkgs.btop
        devenv
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
        pkgs.bun
        pkgs.docker
        ghui
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
        pkgs."google-chrome"
        pkgs.docker
        zed
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
