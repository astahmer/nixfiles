{ pkgs }:
let
  sourceFor =
    system: version:
    {
      x86_64-linux = {
        url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-linux-x86_64";
        hash = "sha256-e3OFELqy56rhtLKiNknOBcen9GbFocgeSiFxv7BZKKM=";
      };
      aarch64-linux = {
        url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-linux-arm64";
        hash = "sha256-5zNjRJGDRbUkdxeZaWvLaSzcETD4yZF+f1ZdMb3vCB4=";
      };
      aarch64-darwin = {
        url = "https://github.com/chronologos/lightjj/releases/download/v${version}/lightjj-macos-arm64";
        hash = "sha256-h1Gmlhw2afEe4Ndw2r8JcN7msBGz7xAhrDN2XsHmnj8=";
      };
    }
    .${system} or (throw "Unsupported platform for lightjj: ${system}");
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "lightjj";
  version = "1.37.0";

  src = pkgs.fetchurl (sourceFor pkgs.stdenv.hostPlatform.system finalAttrs.version);

  nativeBuildInputs = [ pkgs.makeWrapper ];

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 "$src" "$out/bin/lightjj"
    wrapProgram "$out/bin/lightjj" \
      --prefix PATH : ${
        pkgs.lib.makeBinPath [
          pkgs.jujutsu
          pkgs.git
          pkgs.gh
          pkgs.xdg-utils
          pkgs.openssh
        ]
      }

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
