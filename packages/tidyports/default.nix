{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tidyports";
  version = "1.3.1";

  src = fetchurl {
    url = "https://github.com/dan-fetch-studio/tidyports-releases/releases/download/v${finalAttrs.version}/TidyPorts-${finalAttrs.version}.dmg";
    hash = "sha256-Dj/x43B6LTIuzls5U4SIUJN0V81m8Cz1OCtwTs6yypQ=";
  };

  dontUnpack = true;
  # This is a signed app bundle. Generic Nix fixups reject Sparkle's
  # framework-relative `Current` symlink and can invalidate the bundle.
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    mountPoint="$TMPDIR/tidyports-mount"
    mkdir -p "$mountPoint"
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
    mkdir -p "$out/Applications"
    cp -R "$mountPoint/Tidy Ports.app" "$out/Applications/"
    /usr/bin/hdiutil detach "$mountPoint"
    runHook postInstall
  '';

  meta = {
    description = "macOS menu bar app for monitoring and managing local development ports";
    homepage = "https://tidyports.app";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = lib.platforms.darwin;
  };
})
