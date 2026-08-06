{
  lib,
  stdenvNoCC,
  fetchurl,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "crisp";
  version = "1.3.2";

  src = fetchurl {
    url = "https://github.com/didriksg/Crisp/releases/download/v${finalAttrs.version}/Crisp.dmg";
    hash = "sha256-IJLYqS+dJc/fQaI5t63dGqCXkcV2luRkzgxXyb4m8HI=";
  };

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mountPoint="$TMPDIR/crisp-mount"
    mkdir -p "$mountPoint"
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
    mkdir -p "$out/Applications"
    cp -R "$mountPoint/Crisp.app" "$out/Applications/"
    /usr/bin/hdiutil detach "$mountPoint"
    runHook postInstall
  '';

  meta = {
    description = "Free, open-source external display manager for macOS";
    homepage = "https://github.com/didriksg/Crisp";
    license = lib.licenses.mit;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = lib.platforms.darwin;
  };
})
