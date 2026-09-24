{
  buildGoModule,
  fzf,
  git,
  jujutsu,
  lib,
  makeWrapper,
}:
buildGoModule (finalAttrs: {
  pname = "jjw";
  version = "0.1.0";

  src = ./.;
  vendorHash = null;

  nativeBuildInputs = [ makeWrapper ];

  ldflags = [
    "-s"
    "-w"
    "-X main.version=${finalAttrs.version}"
  ];

  postInstall = ''
    wrapProgram "$out/bin/jjw" \
      --prefix PATH : "${
        lib.makeBinPath [
          fzf
          git
          jujutsu
        ]
      }"
  '';

  meta = {
    description = "Audit and clean JJ workspaces and Git worktrees";
    mainProgram = "jjw";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
