{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "discord-bin";
  version = "0.0.411";

  src = fetchurl {
    url = "https://stable.dl2.discordapp.net/apps/osx/${finalAttrs.version}/Discord.dmg";
    hash = "sha256-0kqeKV9LbZJ+IbDEB/m9V9LOke+nPafG4rLMb3nQa30=";
  };

  dontUnpack = true;
  # Keep Discord's upstream Developer ID signature intact. Nixpkgs' Discord
  # package reconstructs the app with separately staged modules, which makes
  # Gatekeeper reject the resulting bundle on macOS.
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    mountPoint="$TMPDIR/discord-mount"
    mkdir -p "$mountPoint"
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
    mkdir -p "$out/Applications"
    cp -R "$mountPoint/Discord.app" "$out/Applications/"
    /usr/bin/hdiutil detach "$mountPoint"

    runHook postInstall
  '';

  meta = {
    description = "Discord desktop app (signed prebuilt macOS binary)";
    homepage = "https://discord.com/download";
    license = lib.licenses.unfree;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = lib.platforms.darwin;
  };
})
