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
        url = "https://github.com/dmmulroy/jj-ryu/releases/download/v${version}/ryu-darwin-arm64.tar.gz";
        hash = "sha256-hl45qwUp3F258b+fvCryaW2L3LrFC8NC1a4tZMzSpVc=";
      };
      x86_64-linux = {
        url = "https://github.com/dmmulroy/jj-ryu/releases/download/v${version}/ryu-linux-x64.tar.gz";
        hash = "sha256-fM3DQZYW5pJ6EaR1u1u0J4Sx44u0EUKW3JLU29xi/us=";
      };
    }
    .${system} or (throw "Unsupported platform for jj-ryu: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "jj-ryu";
  version = "0.0.1-alpha.12";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  sourceRoot = ".";

  installPhase = ''
    runHook preInstall
    install -Dm755 ryu "$out/bin/ryu"
    runHook postInstall
  '';

  meta = {
    description = "Stacked PRs for Jujutsu (jj-ryu)";
    homepage = "https://github.com/dmmulroy/jj-ryu";
    license = lib.licenses.mit;
    mainProgram = "ryu";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
