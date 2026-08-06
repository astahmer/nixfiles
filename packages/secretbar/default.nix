{
  lib,
  stdenv,
  swift,
  swiftpm,
}:
stdenv.mkDerivation {
  pname = "secretbar";
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
    app="$out/Applications/SecretBar.app"
    mkdir -p "$app/Contents/MacOS" "$out/bin"
    install -m755 "$NIX_BUILD_TOP/.build/release/secretbar" "$app/Contents/MacOS/secretbar"
    install -m644 "$src/Info.plist" "$app/Contents/Info.plist"
    cat > "$out/bin/secretbar" <<EOF
    #!/bin/sh
    exec /usr/bin/open "$app"
    EOF
    chmod +x "$out/bin/secretbar"
    runHook postInstall
  '';

  # Same nixpkgs swift-on-darwin runtime repointing as packages/secret: the
  # store corelibs dylibs die with SIGKILL at dyld load; the system dyld-cache
  # runtime is ABI-compatible.
  postFixup = lib.optionalString stdenv.isDarwin ''
    for dylib in $(/usr/bin/otool -L "$out/Applications/SecretBar.app/Contents/MacOS/secretbar" | awk '/\/nix\/store\/.*\/lib\/swift\// { print $1 }'); do
      /usr/bin/install_name_tool -change "$dylib" "/usr/lib/swift/$(basename "$dylib")" "$out/Applications/SecretBar.app/Contents/MacOS/secretbar"
    done
  '';

  meta = {
    description = "macOS menu bar launcher for the secret CLI: cross-project search, click-to-copy, Touch ID unlock";
    license = lib.licenses.mit;
    mainProgram = "secretbar";
    platforms = lib.platforms.darwin;
  };
}
