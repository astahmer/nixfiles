{ pkgs }:
let
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/lidge-jun/opencodex/releases/download/v${version}/ocx-${version}-bun-darwin-arm64.tar.gz";
        hash = "sha256-Cx6wx5pcq9pP357MW4OfAekKKPa7Y8J/C+j9Yy43t4s=";
      };
      x86_64-linux = {
        url = "https://github.com/lidge-jun/opencodex/releases/download/v${version}/ocx-${version}-bun-linux-x64.tar.gz";
        hash = "sha256-r2B8JLd3npCns9zrfNLoxQ8MrIAIi16zvOTJtfHCVkw=";
      };
    }
    .${system} or (throw "Unsupported platform for opencodex: ${system}");
in
pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencodex";
  version = "2.63.0-preview.20260923";

  src = pkgs.fetchurl (sourceFor pkgs.stdenvNoCC.hostPlatform.system finalAttrs.version);
  guiSrc = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@bitkyc08/opencodex/-/opencodex-${finalAttrs.version}.tgz";
    hash = "sha256-GtFnVkvIzyoYrM36cOF8FCJHBdvwST3oy3OVEHpmWYU=";
  };
  sourceRoot = ".";

  nativeBuildInputs =
    pkgs.lib.optional pkgs.stdenvNoCC.hostPlatform.isLinux pkgs.autoPatchelfHook
    ++ [
      pkgs.gnutar
    ];
  buildInputs = pkgs.lib.optional pkgs.stdenvNoCC.hostPlatform.isLinux pkgs.glibc;

  installPhase = ''
    runHook preInstall

    install -Dm755 ocx "$out/bin/ocx"
    ln -s ocx "$out/bin/opencodex"
    mkdir -p "$out/bin/gui/dist" "$TMPDIR/opencodex-gui"
    ${pkgs.gnutar}/bin/tar -xzf "${finalAttrs.guiSrc}" -C "$TMPDIR/opencodex-gui" package/gui/dist
    cp -R "$TMPDIR/opencodex-gui/package/gui/dist/." "$out/bin/gui/dist/"

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
