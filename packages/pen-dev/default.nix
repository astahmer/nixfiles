{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "pen-dev";
  version = "1.2.0";

  src = fetchurl {
    url = "https://github.com/highagency/pencil-desktop-releases/releases/download/v${finalAttrs.version}/Pencil-${finalAttrs.version}-mac-arm64.zip";
    hash = "sha256-ZPHD2oFss5oBvY9LPclGnGXngMpctrTffWZx0jFxIes=";
  };

  strictDeps = true;
  __structuredAttrs = true;
  dontFixup = true;

  nativeBuildInputs = [ unzip ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R "Pencil.app" "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "pen.dev design canvas desktop app (prebuilt macOS binary)";
    homepage = "https://www.pen.dev/";
    changelog = "https://github.com/highagency/pencil-desktop-releases/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
  };
})
