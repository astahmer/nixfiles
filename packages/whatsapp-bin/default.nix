{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "whatsapp-bin";
  version = "2.26.36.18";

  src = fetchurl {
    url = "https://web.whatsapp.com/desktop/mac_native/release/?version=${finalAttrs.version}&extension=dmg&configuration=Release&branch=master";
    hash = "sha256-SxBqAF+dYTqfojU+1vaWol3XToYDDbDSWmlH+dE6kwM=";
  };

  dontUnpack = true;
  # Preserve WhatsApp's Developer ID signature. Nix fixups can invalidate
  # Sparkle/framework signatures in an otherwise ready-to-run app bundle.
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mountPoint="$TMPDIR/whatsapp-mount"
    mkdir -p "$mountPoint"
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
    mkdir -p "$out/Applications"
    cp -R "$mountPoint/WhatsApp.app" "$out/Applications/"
    /usr/bin/hdiutil detach "$mountPoint"

    runHook postInstall
  '';

  meta = {
    description = "WhatsApp desktop app (signed prebuilt macOS binary)";
    homepage = "https://www.whatsapp.com/";
    downloadPage = "https://www.whatsapp.com/download/desktop";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = lib.platforms.darwin;
  };
})
