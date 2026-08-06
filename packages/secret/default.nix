{
  lib,
  stdenv,
  swift,
  swiftpm,
}:
stdenv.mkDerivation {
  pname = "secret";
  version = "2.0.0";

  src = ./.;

  nativeBuildInputs = [
    swift
    swiftpm
  ];

  buildPhase = ''
    runHook preBuild
    swift build -c release --scratch-path "$NIX_BUILD_TOP/.build"
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 "$NIX_BUILD_TOP/.build/release/secret" "$out/bin/secret"
    runHook postInstall
  '';

  meta = {
    description = "Native Swift v2 secret CLI: scoped Bitwarden reads/writes with a bw serve daemon";
    license = lib.licenses.mit;
    mainProgram = "secret";
    platforms = lib.platforms.all;
  };
}
