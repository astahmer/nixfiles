{ pkgs }:
let
  hostBinary =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        name = "plannotator-darwin-arm64";
        hash = "sha256-gtTgfg/OGNycp1f1M3OxNPVO75ver2AMwjFCYRHampk="; # executable=true NAR hash
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        name = "plannotator-darwin-x64";
        hash = "sha256-/RlgPOTSHnDYYRm3uf0refjinrAjMLOoH4muZTN2cwY=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        name = "plannotator-linux-arm64";
        hash = "sha256-YwEg2GurfqB6iOHqICIcYeImBUUlW0yPR65z36KMfjw=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        name = "plannotator-linux-x64";
        hash = "sha256-mk8o1utMjKLez6oaaAbb3mOUXUzHs9z57q+lisJWeXI=";
      }
    else
      throw "Unsupported platform for plannotator";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plannotator";
  version = "0.27.20";

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
