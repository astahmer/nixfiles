{ inputs, ... }:
{
  config.flake.modules.homeManager.opencodex =
    { pkgs, ... }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
    in
    {
      # `ocx` wrapper execs `bun` from PATH (same pattern as ghui).
      home.packages = [
        pkgs.bun
        opencodex
      ];
    };

  config.flake.modules.nixos.opencodex =
    { pkgs, ... }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
    in
    {
      environment.systemPackages = [
        pkgs.bun
        opencodex
      ];
    };
}
