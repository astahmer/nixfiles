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

  # nixpkgs' swift-on-darwin links a few stdlib dylibs (observed:
  # libswift_StringProcessing) from its own corelibs store runtime, which
  # dies with SIGKILL at dyld load when mixed with the system runtime. The
  # system dyld-cache runtime is ABI-compatible, so repoint every store
  # swift dylib to /usr/lib/swift.
  postFixup = lib.optionalString stdenv.isDarwin ''
    for dylib in $(/usr/bin/otool -L "$out/bin/secret" | awk '/\/nix\/store\/.*\/lib\/swift\// { print $1 }'); do
      /usr/bin/install_name_tool -change "$dylib" "/usr/lib/swift/$(basename "$dylib")" "$out/bin/secret"
    done
  '';

  meta = {
    description = "Native Swift v2 secret CLI: scoped Bitwarden reads/writes with a bw serve daemon";
    license = lib.licenses.mit;
    mainProgram = "secret";
    platforms = lib.platforms.all;
  };
}
