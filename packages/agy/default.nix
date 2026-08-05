{
  lib,
  stdenvNoCC,
  fetchurl,
  autoPatchelfHook,
}:
let
  sourceFor =
    system: version: buildId:
    {
      aarch64-darwin = {
        url = "https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}-${buildId}/darwin-arm/cli_mac_arm64.tar.gz";
        hash = "sha256-BhfUqnsOp7oeJBQ7UXjSj+uu2OX9Sbfm6Zdl1CANKe8=";
      };
      x86_64-linux = {
        url = "https://storage.googleapis.com/antigravity-public/antigravity-cli/${version}-${buildId}/linux-x64/cli_linux_x64.tar.gz";
        hash = "sha256-npTP/6hp7iv5qzLgXv87qkZhtm1eAKL9QKjF3G+b1FA=";
      };
    }
    .${system} or (throw "Unsupported platform for agy: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "agy";
  version = "1.1.10";
  buildId = "6423386432339968";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version finalAttrs.buildId);

  sourceRoot = ".";
  dontBuild = true;
  # The macOS build ships self-signed; keep it untouched. Linux needs
  # autoPatchelfHook to point the dynamic loader at Nix's glibc.
  dontFixup = stdenvNoCC.hostPlatform.isDarwin;

  nativeBuildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [
    autoPatchelfHook
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 antigravity "$out/bin/agy"
    runHook postInstall
  '';

  meta = {
    description = "Google Antigravity CLI, the no-key vision provider used by ModLens";
    homepage = "https://antigravity.google/";
    license = lib.licenses.unfree;
    mainProgram = "agy";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
