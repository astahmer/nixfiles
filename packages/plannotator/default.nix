{ pkgs }:
let
  hostBinary =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        name = "plannotator-darwin-arm64";
        hash = "sha256-J2BEue6Aa/VrNXLLx0BTKP5c99x9lS8jprKfs8nx3c8="; # executable=true NAR hash
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        name = "plannotator-darwin-x64";
        hash = "sha256-NEgzXyVRtrRqWTAQn+SDMGA+aeJbclpHD2h5gD7h7l4=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        name = "plannotator-linux-arm64";
        hash = "sha256-YK99XwJUbFb190LTItE7JIlBJku613J+dtJpKHcS1Zg=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        name = "plannotator-linux-x64";
        hash = "sha256-v4DxzdfgJTo4JQ0Q6rxlfezwBaByjkq7Imda2w0VQqM=";
      }
    else
      throw "Unsupported platform for plannotator";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plannotator";
  version = "0.25.1";

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
