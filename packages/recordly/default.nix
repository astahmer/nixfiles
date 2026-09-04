{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "recordly";
  version = "1.3.3";

  src = fetchurl {
    url = "https://github.com/webadderallorg/Recordly/releases/download/v${finalAttrs.version}/Recordly-arm64.zip";
    hash = "sha256-9D+2qGc8L3pycxHgO1tjD3rKmokuP1xN9t0x/sK9acg=";
  };

  strictDeps = true;
  __structuredAttrs = true;
  dontFixup = true;

  nativeBuildInputs = [ unzip ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R "Recordly.app" "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "Open-source screen recorder and editor (prebuilt macOS binary)";
    homepage = "https://recordly.dev/";
    changelog = "https://github.com/webadderallorg/Recordly/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.agpl3Only;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
  };
})
