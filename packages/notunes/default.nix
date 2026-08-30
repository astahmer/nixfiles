{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "notunes";
  version = "3.5";

  src = fetchurl {
    url = "https://github.com/tombonez/noTunes/releases/download/v${finalAttrs.version}/noTunes-${finalAttrs.version}.zip";
    hash = "sha256-B4Nc+fO/MU0R8uvlKAcqIA/6LVXzjeWQhZecLUduo9U=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    unzip
  ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications"
    cp -R noTunes.app "$out/Applications/"
    runHook postInstall
  '';

  meta = {
    description = "macOS menu bar app that stops Music.app from launching when you press media keys or connect Bluetooth devices";
    homepage = "https://github.com/tombonez/noTunes";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = lib.platforms.darwin;
  };
})
