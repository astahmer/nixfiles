{ pkgs, lib, ... }:
let
  backgroundMusic = pkgs.stdenvNoCC.mkDerivation {
    pname = "background-music";
    version = "0.4.3";

    src = pkgs.fetchurl {
      url = "https://github.com/kyleneideck/BackgroundMusic/releases/download/v0.4.3/BackgroundMusic-0.4.3.pkg";
      hash = "sha256-wcSKN8g69EzlC+5oh5hWyWsvbJc2DORhscfWU1Fb5/0=";
    };

    dontUnpack = true;
    dontFixup = true;

    nativeBuildInputs = [
      pkgs.cpio
      pkgs.gzip
      pkgs.xar
    ];

    installPhase = ''
      runHook preInstall

      workdir=$(mktemp -d)
      cd "$workdir"

      xar -xf "$src"
      cd Installer.pkg
      gzip -dc Payload | cpio -idm

      mkdir -p "$out/Applications"
      cp -R "Applications/Background Music.app" "$out/Applications/"

      mkdir -p "$out/Library/Audio/Plug-Ins/HAL"
      cp -R "Library/Audio/Plug-Ins/HAL/Background Music Device.driver" \
        "$out/Library/Audio/Plug-Ins/HAL/"

      runHook postInstall
    '';

    meta = {
      description = "macOS audio utility for per-app volume control and auto-pausing music";
      homepage = "https://github.com/kyleneideck/BackgroundMusic";
      license = lib.licenses.gpl2Plus;
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ backgroundMusic ];

  home.file."Library/Audio/Plug-Ins/HAL/Background Music Device.driver".source =
    "${backgroundMusic}/Library/Audio/Plug-Ins/HAL/Background Music Device.driver";
}
