{ ... }:
{
  config.flake.modules.homeManager.t3code =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    {
      home.activation.t3codeSeedProviderInstances = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        export PATH="${pkgs.nodejs_24}/bin:$PATH"
        OPENCODE_BIN="${config.home.homeDirectory}/.nix-profile/bin/opencode2" \
          node "${../assets/t3code/seed-provider-instances.mjs}" || true
      '';
    };

  config.flake.modules.nixos.t3code =
    { ... }:
    {
      # T3 Code is a desktop app; on NixOS the seed is only useful when the
      # user data directory is reachable, so this is intentionally a no-op.
      environment.systemPackages = [ ];
    };
}
