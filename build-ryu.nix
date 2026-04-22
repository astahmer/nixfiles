{ system ? builtins.currentSystem }:
let
  pkgs = import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz";
  }) { inherit system; };
in pkgs.rustPlatform.buildRustPackage rec {
  pname = "jj-ryu";
  version = "0.0.1-alpha.11";

  src = pkgs.fetchFromGitHub {
    owner = "dmmulroy";
    repo = "jj-ryu";
    rev = "main";
    sha256 = "0vp3kc5h9mdi3kfwyzi8467mdr4lwkiikm6hb10b9n42mjz2akl0";
  };

  cargoHash = "sha256-OD1DpV4s6tgOnDEAfJWScdSKqtYArbqIJVClOtUCYa4=";
  doCheck = false;

  meta = with pkgs.lib; {
    description = "Stacked PRs for Jujutsu (jj-ryu)";
    license = licenses.mit;
    homepage = "https://github.com/dmmulroy/jj-ryu";
  };
}
