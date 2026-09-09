{ pkgs }:
let
  hostPackage =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        packageName = "hunkdiff-darwin-arm64";
        hash = "sha256-gNNwZjGdXegaB9cQXPhxxQM8WvNxl9PGiykly8ZpzfM=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        packageName = "hunkdiff-darwin-x64";
        hash = "sha256-GVJ3oi5okPMOFktN2a5F2L0+NfKqo5GgtbdEnwnlu70=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        packageName = "hunkdiff-linux-arm64";
        hash = "sha256-a3Fe2QYCCrkrnJUFjtd2afLE/Naetwl+K+ka7Nld7hQ=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        packageName = "hunkdiff-linux-x64";
        hash = "sha256-1BOgR1+9OutYtXgfIU6BXyeVkCMaAMrFyqh6LLRAnFE=";
      }
    else
      throw "Unsupported platform for hunk";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "hunk";
  version = "0.21.1";

  src = pkgs.fetchFromGitHub {
    owner = "modem-dev";
    repo = "hunk";
    tag = "v${finalAttrs.version}";
    hash = "sha256-8faDOqDXSdp5j8WP07rTW0L44keCPpv9mWoXGKXgvpY=";
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
