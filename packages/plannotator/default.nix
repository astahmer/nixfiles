{ pkgs }:
let
  hostBinary =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        name = "plannotator-darwin-arm64";
        hash = "sha256-OKDmu4OUhqGfUQvVI+wW1iFkaUxri3Hq0EsfzEhnTNc="; # executable=true NAR hash
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        name = "plannotator-darwin-x64";
        hash = "sha256-+a2fEZ42g77um/nDT1RTAweN4/SlMGEfp80tiIVv5b4=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        name = "plannotator-linux-arm64";
        hash = "sha256-NQnJ7ms02mGo0yeZQgyGmnl049BZR+PG2P+tJDFk0UA=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        name = "plannotator-linux-x64";
        hash = "sha256-mKL07Ktu/QPdnsT+qfopVgr2hKzbyG/GR1ByfZuAuAo=";
      }
    else
      throw "Unsupported platform for plannotator";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plannotator";
  version = "0.27.13";

  src = pkgs.fetchurl {
    url = "https://github.com/backnotprop/plannotator/releases/download/v${finalAttrs.version}/${hostBinary.name}";
    hash = hostBinary.hash;
    executable = true;
  };

  dontUnpack = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m755 $src "$out/bin/plannotator"
    runHook postInstall
  '';

  meta = {
    description = "Annotate and review coding agent plans and code diffs visually";
    homepage = "https://plannotator.ai";
    license = pkgs.lib.licenses.mit;
    mainProgram = "plannotator";
    platforms = [
      "aarch64-darwin"
      "x86_64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
})
