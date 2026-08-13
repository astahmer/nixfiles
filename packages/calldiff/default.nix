{
  lib,
  stdenvNoCC,
  fetchFromGitHub,
  nodejs_24,
}:
let
  rev = "d58c48b33327c1c833b88df521f6838e9a5cc8c5";
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "calldiff";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "tanishqkancharla";
    repo = "calldiff";
    inherit rev;
    hash = "sha256-6Lefc0rq4bFyptycBK2Uz8bZR648ca5hymWMvgsJVC4=";
  };

  outputHash = "sha256-Lkjjd4xiOaIwZq8vJdsBvyrMtsDEWqg2lA9Nx6tJYKk=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  dontFixup = true;

  nativeBuildInputs = [ nodejs_24 ];

  buildPhase = ''
    runHook preBuild

    export HOME="$(mktemp -d)"
    export npm_config_cache="$HOME/.npm"
    unset SSL_CERT_FILE CURL_CA_BUNDLE NIX_SSL_CERT_FILE
    npm ci --ignore-scripts --no-audit --no-fund
    npm run build
    npm prune --omit=dev --ignore-scripts --no-audit --no-fund

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/lib/node_modules/calldiff"
    mkdir -p "$package_dir"
    cp -R dist node_modules package.json README.md LICENSE "$package_dir/"

    mkdir -p "$out/share/calldiff/skills"
    cp -R skills/calldiff "$out/share/calldiff/skills/"

    install -d "$out/bin"
    cat > "$out/bin/calldiff" <<'EOF'
    #!/bin/sh
    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
    exec node "$script_dir/../lib/node_modules/calldiff/dist/cli.js" "$@"
    EOF
    chmod 755 "$out/bin/calldiff"

    runHook postInstall
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
})
