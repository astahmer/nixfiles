{ pkgs, lib, ... }:
let
  cmdcmd = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "cmdcmd";
    version = "0.1.4";

    src = pkgs.fetchzip {
      url = "https://github.com/peterp/cmdcmd/releases/download/v${version}/cmdcmd.zip";
      hash = "sha256-FdGhAOr5h22H7G4X+CXzoyANinGgxXneXLXXeJc/SEQ=";
      stripRoot = false;
    };

    dontUnpack = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/Applications"
      cp -R cmdcmd.app "$out/Applications/"

      runHook postInstall
    '';

    meta = {
      description = "Keyboard-first window switcher for macOS";
      homepage = "https://github.com/peterp/cmdcmd";
      license = lib.licenses.fsl11Mit;
      platforms = [ "aarch64-darwin" ];
      sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
    };
  };
in
{
  home.packages = [ cmdcmd ];
}
