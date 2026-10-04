{
  lib,
  writeShellApplication,
  nodejs_24,
  bbAppPath,
}:

# BB ships no standalone CLI package; the only `bb` on this machine is the
# Electron app bundle. Its real client is the unbundled JavaScript shipped next
# to app.asar, so expose it through a stable profile shim instead of pinning a
# store copy of the bundle: the app updates in place and this shim must follow
# it rather than going stale on the next BB update.
writeShellApplication {
  name = "bb";
  runtimeInputs = [ nodejs_24 ];
  text = ''
    exec ${lib.escapeShellArg "${bbAppPath}/Contents/Resources/app.asar.unpacked/node_modules/bb-app/dist/bb.js"} "$@"
  '';
}