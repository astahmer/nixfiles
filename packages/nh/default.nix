{
  lib,
  stdenvNoCC,
  fetchurl,
  autoPatchelfHook,
}:
let
  version = "4.4.2";
  # Upstream ships prebuilt release binaries; nixpkgs' source build has
  # darwin cache misses and recompiles Rust on every bump.
  sourceFor =
    system: version:
    {
      aarch64-darwin = {
        url = "https://github.com/nix-community/nh/releases/download/v${version}/nh-aarch64-darwin";
        hash = "sha256-d0kHCkKBpOpfxrT4CfGN5ifj01droKDh0JIzbhQf87E=";
      };
      x86_64-linux = {
        url = "https://github.com/nix-community/nh/releases/download/v${version}/nh-x86_64-linux";
        hash = "sha256-z6WeVf2nFM5CJ8SY12D2/aL7kHX2+2zZn1hERRjqVhQ=";
      };
    }
    .${system} or (throw "Unsupported platform for nh: ${system}");
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "nh";
  inherit version;

  src = fetchurl (sourceFor stdenvNoCC.hostPlatform.system finalAttrs.version);

  dontUnpack = true;
  dontBuild = true;
  # The macOS binary is self-contained; Linux needs Nix's glibc wired up.
  dontFixup = stdenvNoCC.hostPlatform.isDarwin;

  nativeBuildInputs = lib.optionals stdenvNoCC.hostPlatform.isLinux [
    autoPatchelfHook
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 "$src" "$out/bin/nh"
    runHook postInstall
  '';

  meta = {
    description = "Nix helper: rebuild, clean, search (prebuilt upstream binaries)";
    homepage = "https://github.com/nix-community/nh";
    license = lib.licenses.eupl12;
    mainProgram = "nh";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
