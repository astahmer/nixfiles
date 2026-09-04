{ ... }:
{
  # Keep the app bundle in ~/Applications (linked by macosApps) and expose
  # only the CLI in the Nix profile. This prevents Raycast from indexing both
  # the user-facing app link and a second profile/store app path.
  config.flake.modules.homeManager.vscode =
    { pkgs, ... }:
    let
      vscode = pkgs.vscode;
    in
    {
      home.packages = [
        (pkgs.writeShellScriptBin "code" ''
          app="$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
          if [ -x "$app" ]; then
            exec "$app" "$@"
          fi
          exec "${vscode}/bin/code" "$@"
        '')
      ];
    };
}
