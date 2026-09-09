{
  lib,
  stdenvNoCC,
  fetchurl,
  installShellFiles,
  makeWrapper,
  ripgrep,
  bubblewrap,
}:
let
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/openai/codex/releases/download/rust-v${version}/codex-aarch64-apple-darwin.tar.gz";
        hash = "sha256-jPkR6mdlI7+yEh7FYYSNKrpWSJCtU2202KM1PyuYULE=";
      };
      x86_64-linux = {
        url = "https://github.com/openai/codex/releases/download/rust-v${version}/codex-x86_64-unknown-linux-musl.tar.gz";
        hash = "sha256-9HlCTsoJJITcQNh64oxE9MxAI0pgBF1hMeSTgA2BSjA=";
      };
    }
    .${system} or (throw "Unsupported platform for codex: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "codex";
  version = "0.153.4";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  sourceRoot = ".";

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
  ];

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-* "$out/bin/codex"
    wrapProgram "$out/bin/codex" --prefix PATH : ${
      lib.makeBinPath ([ ripgrep ] ++ lib.optionals stdenvNoCC.hostPlatform.isLinux [ bubblewrap ])
    }

    runHook postInstall
  '';

  postInstall = ''
    installShellCompletion --cmd codex \
      --bash <($out/bin/codex completion bash) \
      --fish <($out/bin/codex completion fish) \
      --zsh <($out/bin/codex completion zsh)
  '';

  meta = {
    description = "Lightweight coding agent that runs in your terminal";
    homepage = "https://github.com/openai/codex";
    changelog = "https://raw.githubusercontent.com/openai/codex/refs/tags/rust-v${finalAttrs.version}/CHANGELOG.md";
    license = lib.licenses.asl20;
    mainProgram = "codex";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
