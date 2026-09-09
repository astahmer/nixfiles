{
  lib,
  stdenvNoCC,
  fetchurl,
}:
let
  # Linux uses the musl archive so the binary is static-pie and needs no
  # autoPatchelf. Darwin ships a self-contained Mach-O. The empty runtime/
  # in the tarball is vestigial — the binary embeds its runtime and extracts
  # it to ~/.cache/nub on first run.
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/nubjs/nub/releases/download/v${version}/nub-darwin-arm64.tar.gz";
        hash = "sha256-CC5NMNNYsZdrIZQJ4I89hFA61gniNHJCPTBmDH77bTw=";
      };
      x86_64-linux = {
        url = "https://github.com/nubjs/nub/releases/download/v${version}/nub-linux-x64-musl.tar.gz";
        hash = "sha256-Q/kuyS7DHVlkl5urw3vcxhkRUVfwYZWlqS7dSA8GZ4Y=";
      };
    }
    .${system} or (throw "Unsupported platform for nub: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "nub";
  version = "0.9.0";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  sourceRoot = ".";
  dontBuild = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 bin/nub "$out/bin/nub"
    ln -s nub "$out/bin/nubx"
    runHook postInstall
  '';

  meta = {
    description = "Fast TypeScript-first runtime and pnpm-compatible package manager for Node";
    homepage = "https://github.com/nubjs/nub";
    license = lib.licenses.mit;
    mainProgram = "nub";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
