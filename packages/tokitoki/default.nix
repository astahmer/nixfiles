# tokitoki — prebuilt-binary packaging.
#
# STATUS: builds from a LOCAL compiled binary via `localBinary`; the
# fetchurl release path activates once a public release exists (repo has
# none yet). Not wired into flake.nix perSystem for that reason — wiring
# it now would make every eval/build of `.#tokitoki` fail on a dead URL.
#
# Local build/test (works today):
#   cd ~/dev/tokitoki && bun run compile
#   nix-build -E 'with import <nixpkgs> {}; callPackage
#     /Users/astahmer/dev/nixfiles/packages/tokitoki
#     { localBinary = /Users/astahmer/dev/tokitoki/dist/tokitoki; }'
#
# Release checklist:
#   1. cd ~/dev/tokitoki && bun run compile
#      (optionally cross-compile: bun build --compile --target=bun-linux-x64 ...)
#   2. Create a GitHub release with dist/tokitoki (+ .sha256)
#   3. Harvest hashes:
#        nix hash file dist/tokitoki
#      or prefetch the URL:
#        nix store prefetch-file <release-url>
#   4. Fill version/url/hash below, drop the localBinary default, then wire
#      into flake.nix perSystem:
#        tokitoki = pkgs'.callPackage ./packages/tokitoki { };
#   5. Also update assets/cli-tools/ (cli-tools.sh list_term + overview.html)
#      per repo convention when the CLI lands in home.packages.
#
# Alternative (source build): a bunDistributable/bunDeps builder is not in
# nixpkgs yet; until then the prebuilt route above is the honest option.
{
  lib,
  stdenvNoCC,
  fetchurl,
  # Path to a locally compiled binary (~/dev/tokitoki/dist/tokitoki).
  # Takes precedence over the fetchurl release download.
  localBinary ? null,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tokitoki";
  # Keep in sync with ~/dev/tokitoki/package.json version on release.
  version = "0.4.0";

  src =
    if localBinary != null then
      localBinary
    else
      fetchurl {
        # TODO(release): real URL once a release exists.
        url = "https://github.com/<owner>/tokitoki/releases/download/v${finalAttrs.version}/tokitoki-darwin-arm64";
        # TODO(hash): replace with `nix hash file` output of the released binary.
        # v0.4.0 darwin-arm64 local build: sha256-WvmMcyaQun3gmXVkIpkE5NNGNr+/5u48GrIVt97yyW0=
        hash = lib.fakeSha256;
      };

  dontUnpack = true;
  dontBuild = true;
  # Prebuilt bun binary; patching would invalidate the hash.
  # Skip fixup entirely so install stays byte-identical to the compiled artifact.
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 $src $out/bin/tokitoki
    runHook postInstall
  '';

  meta = {
    description = "Unified coding-agent usage & session analytics across machines, harnesses, and accounts";
    mainProgram = "tokitoki";
    platforms = [ "aarch64-darwin" ]; # extend per release targets
  };
})
