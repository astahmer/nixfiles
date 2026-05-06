{ pkgs, lib, ... }:
let
  cmdcmd = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "cmdcmd";
    version = "0.1.4";

    src = pkgs.fetchzip {
      url = "https://github.com/peterp/cmdcmd/releases/download/v${version}/cmdcmd.zip";
      hash = "sha256-dFxc3KXy3jlNS/lAAZXrArEdz4tlPWRV6nbuXy1Md7o=";
      stripRoot = false;
    };

    dontUnpack = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/Applications"
      cp -R "$src/cmdcmd.app" "$out/Applications/"

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
