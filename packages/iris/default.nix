{
  lib,
  stdenvNoCC,
  fetchurl,
}:
let
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/versenilvis/iris/releases/download/v${version}/iris_darwin_arm64.tar.gz";
        hash = "sha256-zTqSIz+q22FGGSqYEnGIWvTGPYHasq7FU7jm2xC5yTM=";
      };
      x86_64-linux = {
        url = "https://github.com/versenilvis/iris/releases/download/v${version}/iris_linux_amd64.tar.gz";
        hash = "sha256-akR4EF7zesaq2gamZzZo09ilf3+V3b1IdRSp39nlnac=";
      };
    }
    .${system} or (throw "Unsupported platform for iris: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "iris";
  version = "0.6.3";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  sourceRoot = ".";

  installPhase = ''
    runHook preInstall
    install -Dm755 iris "$out/bin/iris"
    runHook postInstall
  '';

  meta = {
    description = "A shell auto-completion tool for your terminal";
    homepage = "https://github.com/versenilvis/iris";
    license = lib.licenses.bsd0;
    mainProgram = "iris";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
