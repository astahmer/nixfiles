{ pkgs }:
let
  inherit (pkgs) lib stdenv;

  systems = {
    "aarch64-darwin" = {
      file = "nub-darwin-arm64.tar.gz";
      sha256 = "1g0ri88h11f18jlj6bkgy1vj0awj32yi1n4qf4wx4jj48hni3mpi";
    };
    "x86_64-linux" = {
      file = "nub-linux-x64.tar.gz";
      sha256 = "08g1mk6mks8yn7lbgmxid61cv1nhx3mzcimxljn91i8455c33z85";
    };
  };

  asset = systems.${stdenv.hostPlatform.system} or (throw "nub: unsupported system ${stdenv.hostPlatform.system}");
in
stdenv.mkDerivation (finalAttrs: {
  pname = "nub";
  version = "0.2.10";

  src = pkgs.fetchurl {
    url = "https://github.com/nubjs/nub/releases/download/v${finalAttrs.version}/${asset.file}";
    sha256 = asset.sha256;
  };

  sourceRoot = ".";

  nativeBuildInputs = lib.optionals stdenv.isLinux [ pkgs.autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.isLinux [ pkgs.stdenv.cc.cc.lib ];

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r bin "$out/bin"
    cp -r runtime "$out/runtime"
    chmod +x "$out/bin/nub" "$out/bin/nubx"
    runHook postInstall
  '';

  meta = {
    description = "Fast TypeScript-first runtime and pnpm-compatible package manager for Node";
    homepage = "https://nubjs.com";
    downloadPage = "https://github.com/nubjs/nub/releases";
    license = lib.licenses.mit;
    mainProgram = "nub";
    platforms = builtins.attrNames systems;
  };
})
