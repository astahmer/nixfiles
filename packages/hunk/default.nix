{ pkgs }:
let
  hostPackage =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        packageName = "hunkdiff-darwin-arm64";
        hash = "sha256-BUojESjJsukZUQVQKqeavN24sPeDKvHk54CyZ3JMrK8=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        packageName = "hunkdiff-darwin-x64";
        hash = "sha256-C+KEG/J+Y0xcK1sr0xLyoQE2PemXu6mthLGWj/V2kbg=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        packageName = "hunkdiff-linux-arm64";
        hash = "sha256-qOhJBDubii085OS1oJFhplHneKCykzxbReEtBcBsjZ8=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        packageName = "hunkdiff-linux-x64";
        hash = "sha256-TKmFFjNGNoU6bmEEeyEjb0JFu18lOSLY+OW4P16EZzU=";
      }
    else
      throw "Unsupported platform for hunk";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "hunk";
  version = "0.22.0";

  src = pkgs.fetchFromGitHub {
    owner = "modem-dev";
    repo = "hunk";
    tag = "v${finalAttrs.version}";
    hash = "sha256-dc4/xLAyQe7mL/KMcpjsjgHzgf0tRomQAemVABwUWFY=";
  };

  sourceRoot = "source/packages/hunk";

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
