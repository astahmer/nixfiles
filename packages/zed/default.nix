{
  lib,
  stdenvNoCC,
  fetchurl,
  autoPatchelfHook,
  alsa-lib,
}:
let
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/zed-industries/zed/releases/download/v${version}/Zed-aarch64.dmg";
        hash = "sha256-bEiPxp1ThxXLW6KpnUpFiX6ErKGCEaMFSSkcuQ5LZUY=";
      };
      x86_64-darwin = {
        url = "https://github.com/zed-industries/zed/releases/download/v${version}/Zed-x86_64.dmg";
        hash = "sha256-djdI6KavQf3gkcfQaQ9jpCB592lvyF0R4CKAAV+w1KM=";
      };
      aarch64-linux = {
        url = "https://github.com/zed-industries/zed/releases/download/v${version}/zed-linux-aarch64.tar.gz";
        hash = "sha256-fuk7zRBZxPDXAFeMz6AK69pfxSHJQ/4/+/carEGggac=";
      };
      x86_64-linux = {
        url = "https://github.com/zed-industries/zed/releases/download/v${version}/zed-linux-x86_64.tar.gz";
        hash = "sha256-7qYiaNjsX9NYffBvp24HLBBMyl4LCwq+y8KK5bh8C60=";
      };
    }
    .${system} or (throw "Unsupported platform for zed: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "zed";
  version = "1.18.1";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);

  dontUnpack = stdenvNoCC.hostPlatform.isDarwin;
  dontFixup = stdenvNoCC.hostPlatform.isDarwin;

  nativeBuildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [
    autoPatchelfHook
  ];

  buildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [
    alsa-lib
  ];

  sourceRoot = "zed.app";

  installPhase =
    if stdenvNoCC.hostPlatform.isDarwin then
      ''
        runHook preInstall

        mountPoint="$TMPDIR/zed-mount"
        mkdir -p "$mountPoint"
        /usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$mountPoint" "$src"
        mkdir -p "$out/Applications" "$out/bin"
        cp -R "$mountPoint/Zed.app" "$out/Applications/"
        /usr/bin/hdiutil detach "$mountPoint"
        ln -s "$out/Applications/Zed.app/Contents/MacOS/cli" "$out/bin/zed"
        ln -s "$out/Applications/Zed.app/Contents/MacOS/cli" "$out/bin/zeditor"

        runHook postInstall
      ''
    else
      ''
        runHook preInstall

        mkdir -p "$out/libexec" "$out/bin"
        cp -R . "$out/libexec/zed.app"
        ln -s "$out/libexec/zed.app/bin/zed" "$out/bin/zed"
        ln -s "$out/libexec/zed.app/bin/zed" "$out/bin/zeditor"

        runHook postInstall
      '';

  meta = {
    description = "High-performance, multiplayer code editor (prebuilt upstream binary)";
    homepage = "https://zed.dev";
    changelog = "https://github.com/zed-industries/zed/releases/tag/v${finalAttrs.version}";
    license = lib.licenses.gpl3Only;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    mainProgram = "zed";
    platforms = [
      "aarch64-darwin"
      "x86_64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
})
