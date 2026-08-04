{ pkgs }:
let
  hostPackage =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        packageName = "hunkdiff-darwin-arm64";
        hash = "sha256-TfHf5z6OCVkUpz4DjkurRcwXpVe13y0Eqxwwxp3h/Tc=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        packageName = "hunkdiff-darwin-x64";
        hash = "sha256-XblazdFlJ5ZtbJSCWKfRnZLcKdpxmepN8rweZ8+U3qc=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        packageName = "hunkdiff-linux-arm64";
        hash = "sha256-9dYknbOV9BA3unR9WKEAeU8CgI7gjpGCIg7QHhrH8Aw=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        packageName = "hunkdiff-linux-x64";
        hash = "sha256-nZycFQ8aEZLkU01qYOln0FLnHH+oI97ZxA4EgNpylE4=";
      }
    else
      throw "Unsupported platform for hunk";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "hunk";
  version = "0.17.7";

  src = pkgs.fetchFromGitHub {
    owner = "modem-dev";
    repo = "hunk";
    tag = "v${finalAttrs.version}";
    hash = "sha256-0i1k5ktVfhmN30gOSAFZrrjzGW61vwTOZ3gw5aS+fd8=";
  };

  nativeBuildInputs = [ pkgs.makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/hunk" "$out/bin" "$out/share/doc/hunk"

    install -Dm755 bin/hunk.cjs "$out/lib/hunk/bin/hunk.cjs"
    cp -R skills "$out/lib/hunk/"
    install -Dm644 README.md "$out/share/doc/hunk/README.md"
    install -Dm644 LICENSE "$out/share/doc/hunk/LICENSE"

    hostTarball=$(mktemp -d)
    tar -xzf ${
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/${hostPackage.packageName}/-/${hostPackage.packageName}-${finalAttrs.version}.tgz";
        hash = hostPackage.hash;
      }
    } -C "$hostTarball"
    install -Dm755 "$hostTarball/package/bin/hunk" "$out/lib/hunk/hunk-bin"

    makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/hunk" \
      --add-flags "$out/lib/hunk/bin/hunk.cjs" \
      --set HUNK_BIN_PATH "$out/lib/hunk/hunk-bin"

    runHook postInstall
  '';

  meta = {
    description = "Review-first terminal diff viewer for agent-authored changesets";
    homepage = "https://github.com/modem-dev/hunk";
    license = pkgs.lib.licenses.mit;
    mainProgram = "hunk";
    platforms = [
      "aarch64-darwin"
      "x86_64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
  };
})
