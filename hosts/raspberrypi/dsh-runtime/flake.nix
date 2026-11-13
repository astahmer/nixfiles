{
  description = "fnm and Jujutsu for a DSH multi-host runtime on the Raspberry Pi";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "aarch64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pnpm = pkgs.stdenvNoCC.mkDerivation {
        pname = "pnpm";
        version = "12.5.1";

        src = pkgs.fetchurl {
          url = "https://github.com/pnpm/pnpm/releases/download/v12.5.1/pnpm-linux-arm64.tar.gz";
          hash = "sha256-hOEpDoLIAKzUBrbbJ+llDhXbPCNE0SFizDBeoflCxv8=";
        };

        sourceRoot = ".";
        dontBuild = true;
        dontFixup = true;

        installPhase = ''
          mkdir -p "$out/libexec/pnpm" "$out/bin"
          cp -a pnpm dist "$out/libexec/pnpm/"
          ln -s "$out/libexec/pnpm/pnpm" "$out/bin/pnpm"
        '';
      };
      # multi-host installs DSH with `pnpm add -g` but only finds it on the plain SSH PATH.
      dshShim = pkgs.writeShellScriptBin "dsh" ''
        exec "$HOME/.local/share/pnpm/bin/dsh" "$@"
      '';
    in
    {
      packages.${system}.default = pkgs.buildEnv {
        name = "dsh-runtime-tools";
        paths = [
          pkgs.fnm
          pkgs.jujutsu
          pnpm
          dshShim
        ];
      };
    };
}
