{ pkgs }:
pkgs.rustPlatform.buildRustPackage (finalAttrs: {
  pname = "jj-ryu";
  version = "0.0.1-alpha.11";

  src = pkgs.fetchFromGitHub {
    owner = "dmmulroy";
    repo = "jj-ryu";
    tag = "v${finalAttrs.version}";
    hash = "sha256-j5UNQ99HRDDG5vF2whl9j+JMf/QLI9hBjL3iBGW9ixY=";
  };

  cargoHash = "sha256-OD1DpV4s6tgOnDEAfJWScdSKqtYArbqIJVClOtUCYa4=";
  doCheck = false;

  meta = {
    description = "Stacked PRs for Jujutsu (jj-ryu)";
    license = pkgs.lib.licenses.mit;
    homepage = "https://github.com/dmmulroy/jj-ryu";
  };
})
