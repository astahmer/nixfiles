{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "codexbar";
  version = "0.56.4";

  src = fetchurl {
    url = "https://github.com/steipete/CodexBar/releases/download/v${finalAttrs.version}/CodexBar-macos-universal-${finalAttrs.version}.zip";
    hash = "sha256-SZc8VA9zy4ia2fOL1Lpx7F6mb6sO0z/FIJMyDt6KMB4=";
  };

  sourceRoot = ".";

  nativeBuildInputs = [
    unzip
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications" "$out/bin"
    cp -R CodexBar.app "$out/Applications/"
    ln -s "$out/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI" "$out/bin/codexbar"

    runHook postInstall
  '';

  meta = {
    description = "macOS menu bar app for AI coding-provider usage limits (Codex, Claude, Cursor, ...)";
    homepage = "https://github.com/steipete/CodexBar";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "codexbar";
    platforms = lib.platforms.darwin;
  };
})
