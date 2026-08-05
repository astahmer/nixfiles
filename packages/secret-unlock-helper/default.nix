{
  lib,
  stdenv,
  swift,
  swiftpm,
}:
stdenv.mkDerivation {
  pname = "secret-unlock-helper";
  version = "0.1.0";

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
    install -Dm755 "$NIX_BUILD_TOP/.build/release/secret-unlock-helper" "$out/bin/secret-unlock-helper"
    runHook postInstall
  '';

  meta = {
    description = "Touch ID-gated session unlock for the secret CLI";
    license = lib.licenses.mit;
    mainProgram = "secret-unlock-helper";
    platforms = lib.platforms.darwin;
  };
}
