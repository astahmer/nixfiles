{ config, ... }:
{
  config.flake.modules.homeManager.opencodex =
    { pkgs, ... }:
    {
      # `ocx` wrapper execs `bun` from PATH (same pattern as ghui).
      home.packages = [
        pkgs.bun
        (import ../packages/opencodex.nix { inherit pkgs; })
      ];
    };

  config.flake.modules.nixos.opencodex =
    { pkgs, ... }:
    {
      environment.systemPackages = [
        pkgs.bun
        (import ../packages/opencodex.nix { inherit pkgs; })
      ];
    };
}
