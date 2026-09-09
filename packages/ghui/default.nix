{ pkgs }:
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "ghui";
  version = "0.9.1";

  src = pkgs.fetchFromGitHub {
    owner = "kitlangton";
    repo = "ghui";
    tag = "v${finalAttrs.version}";
    hash = "sha256-K051E6+da+JZs16Kna6/Xnwhkk5b6alpC3AT/4kq4pY=";
  };

  outputHash = "sha256-/BfwRF/ITfq2IAICen0mgHoepxi6ONcRDjZCnW9UJJw=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  dontFixup = true;

  nativeBuildInputs = [ pkgs.bun ];

  buildPhase = ''
    runHook preBuild

    export HOME="/tmp/ghui-home"
    export XDG_CACHE_HOME="/tmp/ghui-cache"
    mkdir -p "$HOME" "$XDG_CACHE_HOME"
    bun install --frozen-lockfile --production

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/node_modules/@kitlangton"
    cp -R . "$out/lib/node_modules/@kitlangton/ghui"

    mkdir -p "$out/bin"
    cat > "$out/bin/ghui" <<'EOF'
      #!/bin/sh
      script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec bun "$script_dir/../lib/node_modules/@kitlangton/ghui/bin/ghui.js" "$@"
    EOF
    chmod +x "$out/bin/ghui"

    runHook postInstall
  '';

  meta = {
    description = "Terminal UI for browsing and acting on your open GitHub pull requests across repositories";
    homepage = "https://github.com/kitlangton/ghui";
    license = pkgs.lib.licenses.fsl11Mit;
    mainProgram = "ghui";
    platforms = [ "aarch64-darwin" ];
  };
})
