{ config, ... }:
{
  config.flake.modules.homeManager.ryu =
    { pkgs, ... }:
    {
      home.packages = [ (import ../ryu-package.nix { inherit pkgs; }) ];
    };

  config.flake.modules.nixos.ryu =
    { pkgs, ... }:
    {
      environment.systemPackages = [ (import ../ryu-package.nix { inherit pkgs; }) ];
    };
}
