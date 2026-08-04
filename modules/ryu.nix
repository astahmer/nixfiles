{ inputs, ... }:
{
  config.flake.modules.homeManager.ryu =
    { pkgs, ... }:
    {
      home.packages = [ inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.ryu ];
    };

  config.flake.modules.nixos.ryu =
    { pkgs, ... }:
    {
      environment.systemPackages = [ inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.ryu ];
    };
}
