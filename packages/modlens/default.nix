{
  lib,
  stdenvNoCC,
  fetchurl,
  nodejs_24,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "modlens";
  version = "2.7.4";

  src = fetchurl {
    url = "https://registry.npmjs.org/@liustack/modlens/-/modlens-${finalAttrs.version}.tgz";
    hash = "sha256-jM5OXAa2P4BvDQjYzn3JMbWZOppFYQSiYgSUiImagg0=";
  };

  commander = fetchurl {
    url = "https://registry.npmjs.org/commander/-/commander-13.1.0.tgz";
    hash = "sha256-1XA7ooUzbW1thv7Pep8GTiSIeUl9mMzJjKhJpi40gio=";
  };

  sourceRoot = "package";
  dontBuild = true;
  dontFixup = true;

  installPhase = ''
    runHook preInstall

    test -f dist/main.js
    test -f skills/modlens/SKILL.md

    package_dir="$out/lib/node_modules/@liustack/modlens"
    mkdir -p "$package_dir"
    cp -R . "$package_dir/"

    commander_dir="$package_dir/node_modules/commander"
    mkdir -p "$(dirname "$commander_dir")"
    tar -xzf "$commander" -C "$package_dir/node_modules"
    mv "$package_dir/node_modules/package" "$commander_dir"

    mkdir -p "$out/share/modlens/skills"
    cp -R skills/modlens "$out/share/modlens/skills/"

    install -d "$out/bin"
    cat > "$out/bin/modlens" <<EOF
    #!${stdenvNoCC.shell}
    exec ${nodejs_24}/bin/node "$package_dir/dist/main.js" "\$@"
    EOF
    chmod 755 "$out/bin/modlens"

    runHook postInstall
  '';

  meta = {
    description = "Vision bridge CLI for text-only language models";
    homepage = "https://github.com/liustack/modlens";
    license = lib.licenses.mit;
    mainProgram = "modlens";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
})
