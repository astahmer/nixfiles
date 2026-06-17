{ pkgs }:
let
  inherit (pkgs)
    lib
    stdenv
    nodejs_24
    pnpm_11
    fetchPnpmDeps
    pnpmConfigHook
    makeWrapper
    ;

  src = lib.cleanSourceWith {
    src = ./assets/readbro;
    filter =
      path: type:
      let
        base = builtins.baseNameOf path;
      in
      !(base == "node_modules" || base == "result" || base == "bin");
  };

  # Runtime uses node --experimental-transform-types; devDependencies are local-only.
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
    nodejs_24
    pnpmConfigHook
    pnpm_11
    makeWrapper
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

  installPhase = ''
    runHook preInstall

    app="$out/lib/readbro"
    mkdir -p "$app" "$out/bin"
    cp -r src package.json node_modules "$app/"

    makeWrapper ${nodejs_24}/bin/node "$out/bin/readbro" \
      --add-flags "--no-warnings=ExperimentalWarning" \
      --add-flags "--experimental-transform-types" \
      --add-flags "--experimental-strip-types" \
      --add-flags "$app/src/main.ts"

    runHook postInstall
  '';

  meta = {
    description = "IR-aware read cache MCP + CLI for coding agents";
    license = lib.licenses.mit;
    mainProgram = "readbro";
  };
})
