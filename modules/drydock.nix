{ inputs, ... }:
{
  config.flake.modules.homeManager.drydock =
    { pkgs, ... }:
    {
      home.packages = [ inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.drydock ];

      # drydock's default roots point at ~/Projects; our repos live under ~/dev.
      home.file."Library/Application Support/drydock/config.toml".text = ''
        roots = ["~/dev"]
      '';
    };

  config.flake.modules.nixos.drydock =
    { pkgs, ... }:
    {
      environment.systemPackages = [ inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.drydock ];
    };
}
