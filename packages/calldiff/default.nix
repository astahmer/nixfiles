{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  nodejs_24,
}:
buildNpmPackage rec {
  pname = "calldiff";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "tanishqkancharla";
    repo = "calldiff";
    rev = "d58c48b33327c1c833b88df521f6838e9a5cc8c5";
    hash = "sha256-6Lefc0rq4bFyptycBK2Uz8bZR648ca5hymWMvgsJVC4=";
  };

  npmDepsHash = "sha256-hEhU73MH5ueh3RRYCaTfAI23diwWViThvEw7ip2O9j8=";
  nodejs = nodejs_24;
  npmFlags = [ "--ignore-scripts" ];

  # npm's tsc shim and other bin scripts use `#!/usr/bin/env node`, which does
  # not exist in the Nix build sandbox. Patch them after the deps are linked
  # and before the package's `npm run build` (tsc) runs.
  preBuild = ''
    patchShebangs node_modules
  '';

  postInstall = ''
    mkdir -p "$out/share/calldiff/skills"
    cp -R skills/calldiff "$out/share/calldiff/skills/"
  '';

  meta = {
    description = "Diff call stacks across git commits for agentic code review";
    homepage = "https://github.com/tanishqkancharla/calldiff";
    license = lib.licenses.mit;
    mainProgram = "calldiff";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
}
