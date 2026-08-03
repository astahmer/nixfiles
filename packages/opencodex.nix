{ pkgs }:
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencodex";
  version = "2.10.0";

  src = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@bitkyc08/opencodex/-/opencodex-${finalAttrs.version}.tgz";
    hash = "sha256-Ak4vx/NM/3pYcodzbG3ZuFkOkOaW/jeSG7kPkdQmqJo=";
  };

  bunLock = ../assets/opencodex/bun.lock;

  # Pins the bun-installed node_modules tree (no lockfile in the npm tarball).
  outputHash = "sha256-ckEOP2nyyJdIx4+V2EjLDu4OXFpA2KiARRSJX8OVAk0=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  dontFixup = true;

  nativeBuildInputs = [
    pkgs.bun
    pkgs.jq
  ];

  sourceRoot = "package";

  buildPhase = ''
    runHook preBuild

    export HOME="/tmp/opencodex-home"
    export XDG_CACHE_HOME="/tmp/opencodex-cache"
    mkdir -p "$HOME" "$XDG_CACHE_HOME"

    # Runtime uses nixpkgs bun; skip the npm `bun` dependency download.
    jq 'del(.dependencies.bun) | del(.trustedDependencies)' package.json > package.json.new
    mv package.json.new package.json

    # Use a vendored lockfile so the resolved dependency tree is deterministic.
    cp "${finalAttrs.bunLock}" bun.lock
    bun install --production --frozen-lockfile --ignore-scripts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/node_modules/@bitkyc08"
    cp -R . "$out/lib/node_modules/@bitkyc08/opencodex"

    mkdir -p "$out/bin"
    cat > "$out/bin/ocx" <<'EOF'
      #!/bin/sh
      script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec bun "$script_dir/../lib/node_modules/@bitkyc08/opencodex/src/cli/index.ts" "$@"
    EOF
    chmod +x "$out/bin/ocx"
    ln -s ocx "$out/bin/opencodex"

    runHook postInstall
  '';

  meta = {
    description = "Universal provider proxy for OpenAI Codex and Claude Code";
    homepage = "https://github.com/lidge-jun/opencodex";
    license = pkgs.lib.licenses.mit;
    mainProgram = "ocx";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
