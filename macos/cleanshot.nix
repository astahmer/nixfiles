{ pkgs, lib, ... }:
let
  cleanshot = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "cleanshot";
    version = "4.8.8";

    src = pkgs.fetchurl {
      url = "https://updates.getcleanshot.com/v3/CleanShot-X-${version}.dmg";
      sha256 = "dddd72482120856ba6a2984159aacab47ca221be18cb9467867a4f3ba1cdd8a0";
    };

    nativeBuildInputs = [ pkgs._7zz ];

    # -snld prevents "ERROR: Dangerous symbolic link path was ignored".
    # -xr'!*:com.apple.*' prevents macOS extended attributes from being turned
    # into real files when extracting an APFS .dmg.
    unpackCmd = "7zz x -snld -xr'!*:com.apple.*' $curSrc";

    sourceRoot = ".";

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications"
      cp -r "CleanShot X.app" "$out/Applications/"
      runHook postInstall
    '';

    meta = {
      description = "Screen capturing tool for macOS";
      homepage = "https://getcleanshot.com/";
      license = lib.licenses.unfree;
      sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ cleanshot ];
}
