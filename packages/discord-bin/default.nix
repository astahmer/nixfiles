{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "discord-bin";
  version = "0.0.413";

  src = fetchurl {
    url = "https://stable.dl2.discordapp.net/distro/app/stable/osx/universal/${finalAttrs.version}/Discord.dmg";
    hash = "sha256-6fWXe52xp32QAlMoakOJ2oEt7oLTO3NVgcEFaAdhIDM=";
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
    trap '/usr/bin/hdiutil detach "$mountPoint" >/dev/null 2>&1 || true' EXIT
    /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
    mkdir -p "$out/Applications"
    cp -R "$mountPoint/Discord.app" "$out/Applications/"
    /usr/bin/hdiutil detach "$mountPoint"
    trap - EXIT

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
