{ ... }:
{
  config.flake.modules.homeManager.dsh =
    { config, lib, pkgs, ... }:
    let
      appScript = pkgs.writeText "dsh-web-app.applescript" ''
        on run
          do shell script "/bin/zsh -lc " & quoted form of "exec ${../assets/dsh/start-dsh}"
        end run
      '';
      dshApp = pkgs.runCommand "deepseek-harness-app.app" { } ''
        /usr/bin/osacompile -o "$out" ${appScript}
        /usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string dev.astahmer.dsh.web' "$out/Contents/Info.plist"
        /usr/libexec/PlistBuddy -c 'Set :CFBundleName DeepSeek Harness' "$out/Contents/Info.plist"
        /usr/bin/codesign --force --deep --sign - "$out"
      '';
      dshStartAlias = pkgs.writeShellScript "dsh-start" ''
        exec "$HOME/.local/bin/dsh-web" "$@"
      '';
      profileSync = ../assets/dsh/sync-web-profile.py;
    in
    {
      # DSH rewrites these files itself, so keep writable copies. Reconcile only
      # the Nix-declared plugin entries and marked Cordis block under DSH's lock.
      home.activation.dshWebProfile = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        profile="$HOME/.dsh/profiles/web"
        run mkdir -p "$profile"
        for name in package.json cordis.patch.yml; do
          if [ ! -e "$profile/$name" ]; then
            run install -m 600 "${../assets/dsh/web-profile}/$name" "$profile/$name"
          fi
        done
        run ${pkgs.python3}/bin/python3 "${profileSync}" \
          "$profile" \
          "${../assets/dsh/web-profile/package.json}" \
          "${../assets/dsh/web-profile/cordis.patch.yml}"
      '';
      home.file.".dsh/AGENTS.md".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/AGENTS.md";
      home.file.".local/bin/dsh-web".source = ../assets/dsh/start-dsh;
      home.file.".local/bin/dsh-start".source = dshStartAlias;
      home.shellAliases.dshstart = "dsh-start";

      # The bundle is a directory, which Home Manager cannot link: its
      # activation only emits regular files and symlinks, and its comparison
      # helpers abort with "Is a directory". Registering it with macos-apps
      # rsync-copies it into ~/Applications like every other GUI app here.
      macosAppSources."DeepSeek Harness.app" = "${dshApp}";
    };
}
