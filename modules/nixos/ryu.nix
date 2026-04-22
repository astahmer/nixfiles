{ config, lib, pkgs, ... }:
{
  config.flake.modules.nixos.ryu =
    { pkgs, lib, ... }:
    let
      ryu = pkgs.rustPlatform.buildRustPackage {
        pname = "jj-ryu";
        version = "0.0.1-alpha.11";

        src = pkgs.fetchFromGitHub {
          owner = "dmmulroy";
          repo = "jj-ryu";
          rev = "main";
          sha256 = "0vp3kc5h9mdi3kfwyzi8467mdr4lwkiikm6hb10b9n42mjz2akl0";
        };

        cargoHash = "sha256-OD1DpV4s6tgOnDEAfJWScdSKqtYArbqIJVClOtUCYa4=";

        meta = with pkgs.lib; {
          description = "Stacked PRs for Jujutsu (jj-ryu)";
          license = licenses.mit;
          homepage = "https://github.com/dmmulroy/jj-ryu";
        };
      };
    in {
      # Make ryu available system-wide on NixOS hosts.
      environment.systemPackages = [ ryu ];
    };
}
