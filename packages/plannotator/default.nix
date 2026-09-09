{ pkgs }:
let
  hostBinary =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        name = "plannotator-darwin-arm64";
        hash = "sha256-5mw0RXVVJ23CtIijDIUtUyI0wyrN6zlV5QqnXZOm9yY="; # executable=true NAR hash
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        name = "plannotator-darwin-x64";
        hash = "sha256-b3l5ddh8uyyWLCzcetmqIWRMWAlsRSjhdbxfDlvNxW0=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        name = "plannotator-linux-arm64";
        hash = "sha256-d7YRBdMDUCIbjJz600YVTo9l89COdPAzImAxovolmmA=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        name = "plannotator-linux-x64";
        hash = "sha256-t3lwR/e0kh/ZLEbYs1cwYhYSaThAWOK/I3AXM0n5SGA=";
      }
    else
      throw "Unsupported platform for plannotator";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "plannotator";
  version = "0.27.12";

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
