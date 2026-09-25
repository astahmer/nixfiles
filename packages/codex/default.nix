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
        hash = "sha256-DxUiNiv4yLu1i/L6ijxgCgtyPx1ONAWrgxr+2jJDiQk=";
      };
      x86_64-linux = {
        url = "https://github.com/openai/codex/releases/download/rust-v${version}/codex-x86_64-unknown-linux-musl.tar.gz";
        hash = "sha256-2z/jrao1xQ7ftoqYihF3gv40kpYPtj1wA+tnSMzAZXs=";
      };
    }
    .${system} or (throw "Unsupported platform for codex: ${system}");
  codeModeHostSourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/openai/codex/releases/download/rust-v${version}/codex-code-mode-host-aarch64-apple-darwin.tar.gz";
        hash = "sha256-pbM/9selATTQiF+78ZTK8c4nRbxXlGRFy2ZBZbBtI1c=";
      };
      x86_64-linux = {
        url = "https://github.com/openai/codex/releases/download/rust-v${version}/codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz";
        hash = "sha256-R9MkGeiVyc3btmSiiQv7JQ7w4/3tPacOXyvGFHnxmJw=";
      };
    }
    .${system} or (throw "Unsupported platform for codex: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "codex";
  version = "0.157.0";

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);
  codeModeHostSrc = fetchurl (
    codeModeHostSourceFor stdenvNoCC.hostPlatform.system finalAttrs.version
  );
  sourceRoot = ".";

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
  ];

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-* "$out/bin/codex"
    tar -xzf "${finalAttrs.codeModeHostSrc}" -C "$out/bin"
    mv "$out/bin"/codex-code-mode-host-* "$out/bin/codex-code-mode-host"
    chmod 755 "$out/bin/codex-code-mode-host"
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
