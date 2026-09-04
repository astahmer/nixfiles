{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "claude-desktop";
  version = "1.46388.4";
  revision = "50e62f90a2c85243eef42913398f7c8f1534abef";

  src = fetchurl {
    url = "https://downloads.claude.ai/releases/darwin/universal/${finalAttrs.version}/Claude-${finalAttrs.revision}.zip";
    hash = "sha256-SUw8bnkcXApQQTcfgjSm3/qclCYWXV70x9vPha3lhhc=";
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
