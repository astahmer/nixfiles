{ config, ... }:
{
  config.flake.modules.homeManager.ryu =
    { pkgs, ... }:
    {
      home.packages = [ (import ../packages/ryu.nix { inherit pkgs; }) ];
    };

  config.flake.modules.nixos.ryu =
    { pkgs, ... }:
    {
      environment.systemPackages = [ (import ../packages/ryu.nix { inherit pkgs; }) ];
    };
}
