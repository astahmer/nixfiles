{ config, ... }:
let
  username = config.flake.username;
in
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    let
      zed =
        if pkgs.stdenv.hostPlatform.isDarwin then
          let
            zedDarwinArch = if pkgs.stdenv.hostPlatform.isAarch64 then "aarch64" else "x86_64";
          in
          pkgs.stdenvNoCC.mkDerivation {
            pname = "zed-editor-bin";
            version = "0.233.10";

            src = pkgs.fetchurl {
              url = "https://github.com/zed-industries/zed/releases/download/v0.233.10/Zed-${zedDarwinArch}.dmg";
              sha256 = "sha256-m/2o6+TRfJy5X1oYYbzAalK3MHezTdchSx7yvlOotUY=";
            };

            nativeBuildInputs = [ pkgs.undmg ];

            sourceRoot = ".";

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/Applications" "$out/bin"
              cp -R "Zed.app" "$out/Applications/"
              ln -s "$out/Applications/Zed.app/Contents/MacOS/Zed" "$out/bin/zeditor"

              runHook postInstall
            '';

            meta = {
              description = "High-performance, multiplayer code editor from the creators of Atom and Tree-sitter";
              homepage = "https://zed.dev";
              mainProgram = "zeditor";
              platforms = pkgs.lib.platforms.darwin;
            };
          }
        else
          pkgs.zed-editor;
    in
    {
      home.packages = [
        pkgs."google-chrome"
        pkgs.bat
        pkgs.docker
        pkgs.gh
        pkgs.comma
        pkgs.deadnix
        pkgs.ffmpeg
        pkgs.fzf
        pkgs.hyperfine
        pkgs."jj-starship"
        pkgs.jq
        pkgs.httpie
        pkgs.ncdu
        pkgs.neovim
        pkgs.nixd
        pkgs.nixfmt
        pkgs.tokei
        pkgs.tmux
        pkgs.tree
        zed
        pkgs.fnm
        pkgs.curl
        pkgs.ripgrep
        pkgs."yt-dlp"
        pkgs.uv
        pkgs.htop
        pkgs.btop
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
