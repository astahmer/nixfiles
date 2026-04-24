{ pkgs, lib, ... }:
let
  kap = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "kap";
    version = "3.6.0";

    src = pkgs.fetchurl {
      url = "https://github.com/wulkano/kap/releases/download/v${version}/Kap-${version}-arm64.dmg";
      sha256 = "1qrw8xh6698y378c109bvdiw4gf92hip4lz1nskrviafzpanjjqg";
    };

    nativeBuildInputs = [ pkgs.undmg ];
    sourceRoot = ".";

    installPhase = ''
      runHook preInstall
      mkdir -p "$out/Applications"
      cp -r "Kap.app" "$out/Applications/"
      runHook postInstall
    '';

    meta = {
      description = "An open-source screen recorder built with web technology";
      homepage = "https://github.com/wulkano/kap";
      platforms = lib.platforms.darwin;
    };
  };
in
{
  home.packages = [ kap ];
}
