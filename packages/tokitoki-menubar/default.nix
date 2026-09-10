{
  lib,
  stdenv,
  perl,
  swift,
  swiftpm,
  tokitokiSource,
}:

let
  packageJson = builtins.fromJSON (builtins.readFile "${tokitokiSource}/package.json");
in
stdenv.mkDerivation {
  pname = "tokitoki-menubar";
  version = packageJson.version;
  src = "${tokitokiSource}/menubar/tokitoki-menubar";
  strictDeps = true;
  nativeBuildInputs = [
    perl
    swift
    swiftpm
  ];
  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR/tokitoki-home"
    mkdir -p "$HOME"

    # Tokitoki currently develops the menubar with Apple Swift 6.1, whose
    # trailing-comma-in-call syntax is not accepted by nixpkgs' Swift 5.10.
    # Keep the upstream source pinned while making the package portable to
    # the compiler available in this flake.
    ${perl}/bin/perl -0pi -e 's/,\n(\s*\)+)/\n$1/g' Sources/tokitoki-menubar/main.swift
    ${perl}/bin/perl -0pi -e 's/Task \{ \@MainActor in self\?\.refresh\(\) \}/Task { \@MainActor [weak self] in self?.refresh() }/' Sources/tokitoki-menubar/main.swift

    swift build -c release --disable-sandbox
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 .build/release/tokitoki-menubar "$out/bin/tokitoki-menubar"
    runHook postInstall
  '';

  # nixpkgs' Swift toolchain may link stdlib dylibs from its own corelibs
  # store runtime. macOS kills this GUI binary during launchd startup when
  # those libraries are mixed with the system Swift runtime, so repoint the
  # store dylibs to the ABI-compatible dyld-cache copies.
  postFixup = lib.optionalString stdenv.hostPlatform.isDarwin ''
    for dylib in $(/usr/bin/otool -L "$out/bin/tokitoki-menubar" | awk '/\/nix\/store\/.*\/lib\/swift\// { print $1 }'); do
      /usr/bin/install_name_tool -change "$dylib" "/usr/lib/swift/$(basename "$dylib")" "$out/bin/tokitoki-menubar"
    done
  '';

  meta = {
    description = "Tokitoki macOS menu-bar client";
    homepage = "https://github.com/astahmer/tokitoki";
    mainProgram = "tokitoki-menubar";
    platforms = lib.platforms.darwin;
  };
}
