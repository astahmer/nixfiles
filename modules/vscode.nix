{ ... }:
{
  # The app the user actually runs is the auto-updating official build in
  # /Applications (home-manager's `targets.darwin.copyApps.enable = false`
  # keeps it untouched). Installing the nixpkgs `vscode` package unmodified
  # put a stale `code` CLI in the profile; once the app auto-updated past
  # the pinned package version, the CLI handed its own older
  # `VSCODE_NLS_CONFIG` to the running app and the extension host died with
  # "NLS MISSING" before any extension activated.
  #
  # The nixpkgs package still provides the app itself, so a fresh machine
  # gets a working VS Code + CLI from the flake, but the `code` command is
  # a launcher that prefers the installed official app's own CLI and only
  # falls back to the nixpkgs CLI when no official app is present. That way
  # CLI and running app can never drift apart on machines with the official
  # app, while machines without it still work out of the box.
  config.flake.modules.homeManager.vscode =
    { pkgs, ... }:
    let
      vscode = pkgs.vscode;
    in
    {
      home.packages = [
        # The nixpkgs app bundle, without its exposed `bin/code` so it
        # cannot collide with the launcher below.
        (pkgs.runCommand "vscode-app" { } ''
          mkdir -p "$out/Applications"
          ln -s "${vscode}/Applications/Visual Studio Code.app" "$out/Applications/Visual Studio Code.app"
        '')
        (pkgs.writeShellScriptBin "code" ''
          app="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
          if [ -x "$app" ]; then
            exec "$app" "$@"
          fi
          exec "${vscode}/bin/code" "$@"
        '')
      ];
    };
}
