{ ... }:
{
  config.flake.modules.homeManager.brew =
    { pkgs, lib, ... }:
    let
      casks = [
        "alt-tab"
        "cleanshot"
        "orbstack"
      ];

      brewSetup = pkgs.writeShellScript "brew-setup" ''
        if ! command -v brew &>/dev/null; then
          echo "Homebrew is not installed. Install it from https://brew.sh" >&2
          exit 1
        fi
        ${lib.concatMapStringsSep "\n" (cask: ''
          if ! brew list --cask "${cask}" &>/dev/null; then
            brew install --cask "${cask}"
          fi
        '') casks}
      '';
    in
    {
      home.activation.installHomebrewCasks = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        run ${brewSetup}
      '';
    };
}