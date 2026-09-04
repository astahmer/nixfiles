{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "t3code-bin";
  version = "0.0.40";

  src = fetchurl {
    url = "https://github.com/pingdotgg/t3code/releases/download/v${finalAttrs.version}/T3-Code-${finalAttrs.version}-arm64.zip";
    hash = "sha256-v9kLAdoXayDLWG864pVlDCiuMhk3GV8gN2QIaNI0JgQ=";
  };

  strictDeps = true;
  __structuredAttrs = true;
  dontFixup = true;

  nativeBuildInputs = [ unzip ];

  sourceRoot = ".";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R "T3 Code (Alpha).app" "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "T3 Code (Alpha) desktop app (prebuilt macOS binary)";
    homepage = "https://t3.codes/";
    changelog = "https://github.com/pingdotgg/t3code/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
  };
})
