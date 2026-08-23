# tokitoki — prebuilt-binary packaging.
#
# STATUS: TEMPLATE WITH PLACEHOLDER HASHES — not wired into flake.nix yet.
# The repo has no public releases; once one exists:
#
#   1. cd ~/dev/tokitoki && bun run compile
#      (optionally cross-compile: bun build --compile --target=bun-linux-x64 ...)
#   2. Create a GitHub release with dist/tokitoki (+ .sha256)
#   3. Harvest hashes:
#        nix hash file dist/tokitoki
#      or prefetch the URL:
#        nix store prefetch-file <release-url>
#   4. Fill version/url/hash below, then wire into flake.nix perSystem:
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
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "tokitoki";
  # TODO: keep in sync with ~/dev/tokitoki/package.json version on release.
  version = "0.3.0";

  src = fetchurl {
    # TODO(release): real URL once a release exists.
    url = "https://github.com/<owner>/tokitoki/releases/download/v${finalAttrs.version}/tokitoki-darwin-arm64";
    # TODO(hash): replace with `nix hash file` output of the released binary.
    hash = lib.fakeSha256;
  };

  dontUnpack = true;
  dontBuild = true;
  dontFixup = true; # prebuilt binary; patching would invalidate the hash

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
