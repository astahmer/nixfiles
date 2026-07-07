{ pkgs }:
let
  inherit (pkgs)
    lib
    stdenv
    bun
    ;

  src = lib.cleanSourceWith {
    src = ../assets/plannotator-mcp;
    filter =
      path: type:
      let
        base = builtins.baseNameOf path;
      in
      !(base == "node_modules" || base == "result" || base == "bin" || base == "plannotator-mcp");
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "plannotator-mcp";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [ bun ];

  buildPhase = ''
    runHook preBuild
    bun build ./main.ts --compile --minify --bytecode --outfile plannotator-mcp
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    cp plannotator-mcp "$out/bin/plannotator-mcp"
    runHook postInstall
  '';

  meta = {
    description = "MCP stdio wrapper for the Plannotator CLI";
    license = lib.licenses.mit;
    mainProgram = "plannotator-mcp";
  };
})
