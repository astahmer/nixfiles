{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tldraw-offline";
  version = "1.18.0";

  src = fetchurl {
    url = "https://github.com/tldraw/tldraw-offline/releases/download/v${finalAttrs.version}/tldraw-offline-mac-arm64.zip";
    hash = "sha256-ftiURihYJgcb8A5SPrk0/OMI0tvkOpxeH802W89weVE=";
  };

  strictDeps = true;
  __structuredAttrs = true;
  dontFixup = true;

  nativeBuildInputs = [ unzip ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R "tldraw offline.app" "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "Desktop tldraw editor for local files (prebuilt macOS binary)";
    homepage = "https://offline.tldraw.com/";
    changelog = "https://github.com/tldraw/tldraw-offline/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
  };
})
