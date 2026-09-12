{ stdenvNoCC, tokitokiSource }:

let
  upstream =
    (tokitokiSource.packages.${stdenvNoCC.hostPlatform.system}.default).overrideAttrs (oldAttrs: {
      patches = (oldAttrs.patches or [ ]) ++ [ ./fix-native-codex-email.patch ];
    });
  packageJson = builtins.fromJSON (builtins.readFile "${tokitokiSource}/package.json");
in
# Keep the package exposed from this flake while delegating the reproducible
# source build and Bun dependency hash to Tokitoki's own flake. The upstream
# archive contains a package.json at its root; copying the complete archive
# into home.packages conflicts with other npm-style packages (notably Cursor
# Agent), so expose only the runtime entrypoint and bundled integrations.
stdenvNoCC.mkDerivation {
  pname = "tokitoki";
  version = packageJson.version;
  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    install -d "$out/bin"
    ln -s "${upstream}/bin/tokitoki" "$out/bin/tokitoki"

    if [ -d "${upstream}/share/tokitoki" ]; then
      install -d "$out/share/tokitoki"
      cp -R "${upstream}/share/tokitoki/." "$out/share/tokitoki/"
    fi
    runHook postInstall
  '';
}
