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
        url = "https://github.com/yetidevworks/drydock/releases/download/v${version}/drydock-darwin-aarch64.tar.gz";
        hash = "sha256-uLQPD98SV0Up0wGlqh98SJuXlP/Tx12scy6WbL/wV/I=";
      };
      x86_64-linux = {
        url = "https://github.com/yetidevworks/drydock/releases/download/v${version}/drydock-linux-x86_64.tar.gz";
        hash = "sha256-KKLbgsHa9fSLhljjWrOlFPHnR6N9JiF4miRTuMliVTo=";
      };
    }
    .${system} or (throw "Unsupported platform for drydock: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "drydock";
  version = "0.1.5";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  sourceRoot = ".";

  installPhase = ''
    runHook preInstall
    install -Dm755 drydock "$out/bin/drydock"
    runHook postInstall
  '';

  meta = {
    description = "Live TUI dashboard for uncommitted, unpushed, and unreleased work across your git repos";
    homepage = "https://github.com/yetidevworks/drydock";
    license = lib.licenses.mit;
    mainProgram = "drydock";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
