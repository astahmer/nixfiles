{ pkgs, lib, ... }:
let
  cameraController = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "cameracontroller";
    version = "1.4.0";

    src = pkgs.fetchzip {
      url = "https://github.com/Itaybre/CameraController/releases/download/v${version}/CameraController.zip";
      sha256 = "sha256-r4yDCXO1npWimYWZ8H1/X9zjH77fiPSyTvPvaECvlSM=";
      stripRoot = false;
    };

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications"
      cp -R "CameraController.app" "$out/Applications/"
      runHook postInstall
    '';

    meta = {
      description = "A MacOS app to control USB cameras";
      homepage = "https://github.com/Itaybre/CameraController";
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ cameraController ];
}
