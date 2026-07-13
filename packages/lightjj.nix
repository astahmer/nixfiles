{ pkgs }:
let
  sourceFor = system: version: {
    x86_64-linux = {
      url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-linux-x86_64";
      hash = "sha256-VbigTSVOfD/OgGd/ZQxcY4BumXNrJXBvGhNb8p3x4ms=";
    };
    aarch64-linux = {
      url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-linux-arm64";
      hash = "sha256-CaQ9v/zE3BcpBgNL45MkzbjMVQ1yO32cXn6j8YHr9M8=";
    };
    aarch64-darwin = {
      url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-macos-arm64";
      hash = "sha256-E7DraVz3FTZMs81vIxuWD78dMO1hX3OxkXOn71ufvYs=";
    };
  }.${system} or (throw "Unsupported platform for lightjj: ${system}");
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "lightjj";
  version = "1.32.0";

  src = pkgs.fetchurl (sourceFor pkgs.stdenv.hostPlatform.system finalAttrs.version);

  nativeBuildInputs = [ pkgs.makeWrapper ];

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 "$src" "$out/bin/lightjj"
    wrapProgram "$out/bin/lightjj" \
      --prefix PATH : ${pkgs.lib.makeBinPath [
        pkgs.jujutsu
        pkgs.git
        pkgs.gh
        pkgs.xdg-utils
        pkgs.openssh
      ]}

    runHook postInstall
  '';

  meta = {
    description = "Fast browser UI for Jujutsu version control";
    homepage = "https://github.com/chronologos/lightjj";
    license = pkgs.lib.licenses.mit;
    mainProgram = "lightjj";
    platforms = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
})
