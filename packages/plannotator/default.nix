{ pkgs }:
let
  hostBinary =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        name = "plannotator-darwin-arm64";
        hash = "sha256-aeKn/3Rr9ZmTrYt6dE8u3zWPTeiW7tER34rVjqr2kn8="; # executable=true NAR hash
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        name = "plannotator-darwin-x64";
        hash = "sha256-78OZQhxiMVlRrkC+Y/ykh1V1XItQuAYIYoGxMAX3r5A=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        name = "plannotator-linux-arm64";
        hash = "sha256-68nRINcGC8/k+QdFa1Q4+po4zWdrsxTvLwE9IV1jAUo=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        name = "plannotator-linux-x64";
        hash = "sha256-VLaBja3G7zjSz0C4fCP3eIbJ8Ot+KoNHC5lNACb6rWE=";
      }
    else
      throw "Unsupported platform for plannotator";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plannotator";
  version = "0.27.15";

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
