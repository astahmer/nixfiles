{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "recordly";
  version = "1.4.0";

  src = fetchurl {
    url = "https://github.com/webadderallorg/Recordly/releases/download/v${finalAttrs.version}/Recordly-arm64.zip";
    hash = "sha256-9fpPldjwkOj6cUFIzgpPSaFZL+N7/1+oJREnmqnF4Ik=";
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
