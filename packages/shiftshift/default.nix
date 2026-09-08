{
  lib,
  pkgs,
  stdenvNoCC,
  shiftshiftNixpkgs,
  shiftshiftRustOverlay,
  shiftshiftSource,
  shiftshiftIcon,
  version,
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  shiftPkgs = import shiftshiftNixpkgs {
    inherit system;
    overlays = [ shiftshiftRustOverlay ];
  };

  rustToolchain = shiftPkgs.rust-bin.stable."1.93.0".default;
  rustPlatform = shiftPkgs.makeRustPlatform {
    cargo = rustToolchain;
    rustc = rustToolchain;
  };

  # Build from the locked app source rather than consuming the app flake's
  # package output. Its current fixed-output pnpm hash is stale, while this
  # package needs to remain buildable from the version pinned in flake.lock.
  frontendSrc = shiftshiftSource;
  pnpmDeps = shiftPkgs.fetchPnpmDeps {
    pname = "shiftshift-frontend";
    inherit version;
    src = frontendSrc;
    fetcherVersion = 4;
    hash = "sha256-uFbzz1sYxoHxhCOhJkCY7pLT3r9gX7rPHf3EOUT7014=";
  };

  frontendDist = shiftPkgs.stdenv.mkDerivation {
    pname = "shiftshift-frontend";
    inherit version;
    src = frontendSrc;
    inherit pnpmDeps;
    nativeBuildInputs = [
      shiftPkgs.nodejs_24
      shiftPkgs.pnpm
      shiftPkgs.pnpmConfigHook
    ];

    buildPhase = ''
      runHook preBuild
      pnpm run build
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r dist/. $out/
      runHook postInstall
    '';
  };

  # Tauri embeds ../dist at compile time, so assemble a source tree with
  # src-tauri/ and the built frontend as siblings.
  rustSrc = shiftPkgs.runCommand "shiftshift-src" { } ''
    mkdir -p $out
    cp -r ${shiftshiftSource}/.cargo $out/.cargo
    mkdir -p $out/src-tauri
    cp -r ${shiftshiftSource}/src-tauri/Cargo.toml $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/Cargo.lock $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/build.rs $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/tauri.conf.json $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/src $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/icons $out/src-tauri/
    cp -r ${shiftshiftSource}/src-tauri/capabilities $out/src-tauri/
    cp -r ${frontendDist} $out/dist
  '';

  shiftshiftBinary = rustPlatform.buildRustPackage {
    pname = "shiftshift-tauri";
    inherit version;
    src = rustSrc;
    sourceRoot = "shiftshift-src/src-tauri";

    cargoLock.lockFile = "${shiftshiftSource}/src-tauri/Cargo.lock";
    nativeBuildInputs = [
      shiftPkgs.perl
      shiftPkgs.pkg-config
    ];

    # The tests exercise global keyboard hooks, clipboard, and tray APIs, so
    # they are not appropriate for a sandboxed non-interactive package build.
    doCheck = false;
  };
in

# Add the macOS bundle metadata that Home Manager needs in order to put the
# app in ~/Applications. It is intentionally unsigned; signing/notarization
# remains the release workflow's responsibility.
stdenvNoCC.mkDerivation {
  pname = "shiftshift";
  inherit version;

  dontUnpack = true;
  dontBuild = true;
  dontFixup = true;
  strictDeps = true;

  installPhase = ''
    runHook preInstall

    app="$out/Applications/shiftshift.app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$out/bin"

    cp "${shiftshiftBinary}/bin/shiftshift-tauri" "$app/Contents/MacOS/shiftshift-tauri"
    chmod 755 "$app/Contents/MacOS/shiftshift-tauri"
    cp "${shiftshiftIcon}" "$app/Contents/Resources/shiftshift.icns"

    cat > "$app/Contents/Info.plist" <<EOF
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>CFBundleDisplayName</key>
      <string>shiftshift</string>
      <key>CFBundleExecutable</key>
      <string>shiftshift-tauri</string>
      <key>CFBundleIconFile</key>
      <string>shiftshift.icns</string>
      <key>CFBundleIdentifier</key>
      <string>dev.shiftshift.tauri</string>
      <key>CFBundleInfoDictionaryVersion</key>
      <string>6.0</string>
      <key>CFBundleName</key>
      <string>shiftshift</string>
      <key>CFBundlePackageType</key>
      <string>APPL</string>
      <key>CFBundleShortVersionString</key>
      <string>${version}</string>
      <key>CFBundleVersion</key>
      <string>${version}</string>
      <key>LSMinimumSystemVersion</key>
      <string>10.13</string>
      <key>NSHighResolutionCapable</key>
      <true/>
    </dict>
    </plist>
    EOF

    ln -s "${shiftshiftBinary}/bin/shift" "$out/bin/shift"

    runHook postInstall
  '';

  meta = {
    description = "Quick-capture desktop utility — double-tap Shift to save a note, todo, link, or image";
    homepage = "https://github.com/astahmer/shiftshift-app";
    license = lib.licenses.mit;
    mainProgram = "shift";
    platforms = [ "aarch64-darwin" ];
  };
}
