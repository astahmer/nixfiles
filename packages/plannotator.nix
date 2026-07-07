{ pkgs }:
let
  version = "0.22.0";

  hostBinary = if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
    {
      name = "plannotator-darwin-arm64";
      hash = "sha256-ZREVUsy4qiHg6Y9Tpdj7VlFcvmBQ8mNFb+oV5ZeS+eM=";
    }
  else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
    {
      name = "plannotator-darwin-x64";
      hash = "sha256-ADMXxRWhxE0oSpQApe/KBZUiGZnym/LeZxJDl2orOQo=";
    }
  else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
    {
      name = "plannotator-linux-arm64";
      hash = "sha256-tTtIbLDTtGs0UdKpyWQ/GiGb9I3nt/KXJGhxhM3oyiQ=";
    }
  else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
    {
      name = "plannotator-linux-x64";
      hash = "sha256-03G3gkKjHWh7rc0ncrc1fjOVZ8h0tE56UDFtHRHSp9E=";
    }
  else
    throw "Unsupported platform for plannotator";

  src = pkgs.fetchurl {
    url = "https://github.com/backnotprop/plannotator/releases/download/v${version}/${hostBinary.name}";
    hash = hostBinary.hash;
    executable = true;
  };
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "plannotator";
  inherit version;

  dontUnpack = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m755 ${src} "$out/bin/plannotator"
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
}
