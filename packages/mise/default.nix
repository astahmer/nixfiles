{
  lib,
  stdenvNoCC,
  fetchurl,
  installShellFiles,
}:
let
  version = "2026.8.10";
  # Upstream ships static musl binaries on Linux and self-contained binaries
  # on macOS, so no autoPatchelf is needed on either platform.
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/jdx/mise/releases/download/v${version}/mise-v${version}-macos-arm64.tar.xz";
        hash = "sha256-qBkDePbAs5TFQGhAUmAoLc/yrxShU7MnGYz0xENk4bE=";
      };
      x86_64-linux = {
        url = "https://github.com/jdx/mise/releases/download/v${version}/mise-v${version}-linux-x64-musl.tar.xz";
        hash = "sha256-gThhXQxTjqoYLpJrOZSrjn+B2U+L5uAkAXUYL3x0wSw=";
      };
    }
    .${system} or (throw "Unsupported platform for mise: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "mise";
  inherit version;

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);

  # keep the top-level `mise/` dir so install paths stay explicit
  sourceRoot = ".";
  dontBuild = true;
  dontFixup = true;

  nativeBuildInputs = [ installShellFiles ];

  installPhase = ''
    runHook preInstall
    install -Dm755 mise/bin/mise "$out/bin/mise"
    installManPage mise/man/man1/mise.1
    cp -r mise/share/. "$out/share/"
    runHook postInstall
  '';

  meta = {
    description = "Polyglot runtime dev tooling manager (prebuilt upstream binaries)";
    homepage = "https://mise.jdx.dev/";
    license = lib.licenses.mit;
    mainProgram = "mise";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
