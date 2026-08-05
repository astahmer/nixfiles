{
  lib,
  stdenvNoCC,
  fetchurl,
  fetchFromGitHub,
  nodejs_24,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "modsearch";
  version = "3.1.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/@liustack/modsearch/-/modsearch-${finalAttrs.version}.tgz";
    hash = "sha256-CREdS/Zk8Rlp/nzDaNbw3NuXGRvBZUjntiP3p2RgSjM=";
  };

  # The npm tarball ships no agent skill; pin the upstream one instead.
  skillSrc = fetchFromGitHub {
    owner = "liustack";
    repo = "modsearch";
    rev = "68578acbb0bcb4ef12c079d2f34ba8baf0f11bf2";
    hash = "sha256-2fbJIo6PelHt4bpKU2c8nQF4vWZFBlS+YYZKkA6YtKc=";
  };

  npmLock = ../../assets/modsearch/package-lock.json;

  # Pins the npm-installed node_modules tree (no lockfile in the npm tarball).
  outputHash = "sha256-3cPfBXvZ2oyCYeva6o3PZEr6A0tl6DO992NxuLxufPM=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  dontFixup = true;

  nativeBuildInputs = [ nodejs_24 ];

  sourceRoot = "package";

  buildPhase = ''
    runHook preBuild

    # Nix injects SSL_CERT_FILE=/no-cert-file.crt into build envs; Node 24
    # honors it as the CA bundle, so npm must fall back to its bundled store.
    unset SSL_CERT_FILE CURL_CA_BUNDLE NIX_SSL_CERT_FILE
    export HOME="$(mktemp -d)"
    cp "${finalAttrs.npmLock}" package-lock.json
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    package_dir="$out/lib/node_modules/@liustack/modsearch"
    mkdir -p "$package_dir"
    cp -R . "$package_dir/"

    mkdir -p "$out/share/modsearch/skills"
    cp -R "${finalAttrs.skillSrc}/skills/modsearch" "$out/share/modsearch/skills/"

    install -d "$out/bin"
    cat > "$out/bin/modsearch" <<EOF
    #!/bin/sh
    # Keep this wrapper free of /nix/store paths: the fixed-output
    # derivation rejects outputs that reference store paths. node is on
    # PATH via the coding profile (nodejs_24).
    script_dir=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
    exec node "\$script_dir/../lib/node_modules/@liustack/modsearch/dist/main.js" "\$@"
    EOF
    chmod 755 "$out/bin/modsearch"

    runHook postInstall
  '';

  meta = {
    description = "Plug-in web search, X search, and page fetch for text-only language models";
    homepage = "https://github.com/liustack/modsearch";
    license = lib.licenses.mit;
    mainProgram = "modsearch";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
