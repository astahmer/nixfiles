{ ... }:
{
  config.flake.modules.homeManager.brew =
    { pkgs, lib, ... }:
    lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      home.activation.homebrewTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if command -v brew >/dev/null 2>&1; then
          if brew info lightjj >/dev/null 2>&1 && ! brew list --formula lightjj >/dev/null 2>&1; then
            brew install lightjj
          fi
        fi
      '';
    };
}