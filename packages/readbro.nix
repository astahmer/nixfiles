{ pkgs }:
let
  inherit (pkgs)
    lib
    stdenv
    bun
    nodejs_26
    pnpm_11
    fetchPnpmDeps
    pnpmConfigHook
    ;

  src = lib.cleanSourceWith {
    src = ./assets/readbro;
    filter =
      path: type:
      let
        base = builtins.baseNameOf path;
      in
      !(base == "node_modules" || base == "result" || base == "bin" || base == "readbro");
  };

  pnpmInstallFlags = [ "--prod" ];

  prePnpmInstall = ''
    export CI=true
    export pnpm_config_child_concurrency=1
    export pnpm_config_network_concurrency=1
  '';
in
stdenv.mkDerivation (finalAttrs: {
  pname = "readbro";
  version = "0.3.0";
  inherit src pnpmInstallFlags prePnpmInstall;

  nativeBuildInputs = [
    bun
    nodejs_26
    pnpmConfigHook
    pnpm_11
  ];

  # Fetched with pnpm 11 (lockfile v9). Regenerate: set hash to "" and rebuild.
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      prePnpmInstall
      pnpmInstallFlags
      ;
    pnpm = pnpm_11;
    fetcherVersion = 3;
    hash = "sha256-+UymkxOxRq5/NZHX9PYPiyLAdRkTUDhq0oYNAh6frD8=";
  };

  buildPhase = ''
    runHook preBuild
    bun build ./src/main.ts --compile --minify --bytecode --outfile readbro
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    cp readbro "$out/bin/readbro"
    runHook postInstall
  '';

  checkPhase = ''
    runHook preCheck
    node --experimental-transform-types --experimental-strip-types --test test/*.test.ts
    runHook postCheck
  '';

  meta = {
    description = "IR-aware read cache MCP + CLI for coding agents";
    license = lib.licenses.mit;
    mainProgram = "readbro";
  };
})
