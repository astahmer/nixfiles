{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "claude-desktop";
  version = "1.49585.0";
  revision = "41ad1dff5275eedc8af25989f59f33c5efe14063";

  src = fetchurl {
    url = "https://downloads.claude.ai/releases/darwin/universal/${finalAttrs.version}/Claude-${finalAttrs.revision}.zip";
    hash = "sha256-fVJGNRT1Ba654W+opSpv8lvRPIOVQJi8L4aNOr4HkvQ=";
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
