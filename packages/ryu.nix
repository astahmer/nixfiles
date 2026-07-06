{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
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

  meta = {
    description = "Stacked PRs for Jujutsu (jj-ryu)";
    license = pkgs.lib.licenses.mit;
    homepage = "https://github.com/dmmulroy/jj-ryu";
  };
}
