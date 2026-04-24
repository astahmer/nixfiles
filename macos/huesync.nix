{ pkgs, lib, ... }:
let
  # The Philips Hue Sync app natively provided as a pkg installer
  hueSync = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "huesync";
    version = "1.13.1.83";

    src = pkgs.fetchurl {
      # Fallback to the known installer or a provided Github link if you have an open source client.
      url = "https://firmware.meethue.com/storage/huesyncmac/83/367fa136-d05e-4de6-8f9b-318fed481842/HueSyncInstaller_1.13.1.83.pkg";
      sha256 = "520d2a6895ae0fee73718a9a6a1be356afe346daa1ae90783750bff3cb12d354";
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
      cd com.lighting.huesync.pkg
      gzip -dc Payload | cpio -idm

      mkdir -p "$out/Applications"
      cp -R "Hue Sync.app" "$out/Applications/"
      runHook postInstall
    '';

    meta = {
      description = "Philips Hue Sync desktop app";
      homepage = "https://www.philips-hue.com";
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ hueSync ];
}
