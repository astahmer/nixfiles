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
        hash = "sha256-6siZLXk+FTGkSUTQ0PtA+zy3FtY8kzID/ARbtUzgjt0=";
      };
      x86_64-linux = {
        url = "https://github.com/yetidevworks/drydock/releases/download/v${version}/drydock-linux-x86_64.tar.gz";
        hash = "sha256-5q1ev2psJHKnX8WAc7jNvZQHWpEB9jwMPDCPxLw8bGk=";
      };
    }
    .${system} or (throw "Unsupported platform for drydock: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "drydock";
  version = "1.2.1";

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
