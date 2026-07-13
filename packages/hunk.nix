{ pkgs }:
let
  hostPackage =
    if pkgs.stdenv.hostPlatform.system == "aarch64-darwin" then
      {
        packageName = "hunkdiff-darwin-arm64";
        hash = "sha256-wwnjeFPt2WrLfRVIdM9U0hbk5Ntf3v7GvU7z/f1ZDyY=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-darwin" then
      {
        packageName = "hunkdiff-darwin-x64";
        hash = "sha256-LPGnO8Pz/sFs7xyYa9sFEGBJZ2VovqmuFXhz/J/fKI8=";
      }
    else if pkgs.stdenv.hostPlatform.system == "aarch64-linux" then
      {
        packageName = "hunkdiff-linux-arm64";
        hash = "sha256-+1/uVxcmkyqYSTDz9gk+aZOgTKUzcypgichFfMwnGF4=";
      }
    else if pkgs.stdenv.hostPlatform.system == "x86_64-linux" then
      {
        packageName = "hunkdiff-linux-x64";
        hash = "sha256-ICkeeCq8X7czMDtVBH3P5lPDhSrgueZMeQb0QwTcfSA=";
      }
    else
      throw "Unsupported platform for hunk";
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "hunk";
  version = "0.10.0";

  src = pkgs.fetchFromGitHub {
    owner = "modem-dev";
    repo = "hunk";
    tag = "v${finalAttrs.version}";
    hash = "sha256-S2EuZW5vzyk3FGhUQbyanE3hdlnb9F6GQMtu2k8pjrM=";
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
    tar -xzf ${pkgs.fetchurl {
      url = "https://registry.npmjs.org/${hostPackage.packageName}/-/${hostPackage.packageName}-${finalAttrs.version}.tgz";
      hash = hostPackage.hash;
    }} -C "$hostTarball"
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
