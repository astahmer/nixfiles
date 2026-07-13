{ pkgs, lib, ... }:
let
  caffeine = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "caffeine";
    version = "1.1.4";

    src = pkgs.fetchurl {
      url = "https://github.com/IntelliScape/caffeine/releases/download/${version}/Caffeine.dmg";
      sha256 = "sha256-GtNMMpmgyGaHPE/rQyw+ERhjda229DxfSBrp1G0G1yM=";
    };

    nativeBuildInputs = [ pkgs.undmg ];
    sourceRoot = ".";

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications"
      cp -r "Caffeine.app" "$out/Applications/"
      runHook postInstall
    '';

    meta = {
      description = "Don't let your Mac fall asleep";
      homepage = "https://intelliscapesolutions.com/apps/caffeine";
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ caffeine ];
}
