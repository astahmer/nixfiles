{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "claude-desktop";
  version = "2.9939.2";
  revision = "d3e50475d5d6bb0c317560310200249dd61b87d8";

  src = fetchurl {
    url = "https://downloads.claude.ai/releases/darwin/universal/${finalAttrs.version}/Claude-${finalAttrs.revision}.zip";
    hash = "sha256-as+MQqYO2iEoQbpmpkOccUDFnEAiIgoXfZzUS1qUkTw=";
  };

  strictDeps = true;
  __structuredAttrs = true;
  dontFixup = true;

  nativeBuildInputs = [ unzip ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R "Claude.app" "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "Anthropic's Claude desktop app (prebuilt macOS binary)";
    homepage = "https://claude.com/download";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
  };
})
