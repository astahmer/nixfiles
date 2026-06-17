{ pkgs }:
pkgs.buildNpmPackage rec {
  pname = "readbro";
  version = "0.2.0";
  src = ./assets/readbro;

  npmDepsHash = "sha256-mOklvA93+7mIWzL5ps7fsU+KysX8WHjcLY8Lj/WguMQ=";

  dontNpmRebuild = true;
  dontNpmBuild = true;

  npmFlags = [
    "--omit=dev"
  ];

  meta = {
    description = "IR-aware read cache MCP for coding agents";
    license = pkgs.lib.licenses.mit;
  };
}
