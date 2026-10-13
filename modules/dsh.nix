{ ... }:
{
  config.flake.modules.homeManager.dsh =
    {
      config,
      lib,
      pkgs,
      ...
    }:
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
      dshfilesWebProfile = "${config.home.homeDirectory}/dev/dshfiles/profiles/web";
    in
    {
      # DSH rewrites its profile; seed portable config and account metadata.
      # Reconcile managed plugins under DSH's lock; keep credentials local.
      home.activation.dshWebProfile = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        dsh_home="''${DSH_HOME:-$HOME/.dsh}"
        profile="$dsh_home/profiles/web"
        source_profile="${dshfilesWebProfile}"
        if [ ! -d "$source_profile" ]; then
          echo "Missing dshfiles web profile at $source_profile" >&2
          exit 1
        fi
        run mkdir -p "$profile"
        for name in package.json cordis.patch.yml pnpm-workspace.yaml; do
          if [ ! -e "$profile/$name" ]; then
            run install -m 600 "$source_profile/$name" "$profile/$name"
          fi
        done
        accounts_file="$dsh_home/plugins/ai-accounts/accounts.json"
        if [ ! -e "$accounts_file" ] && [ ! -L "$accounts_file" ]; then
          run mkdir -p "$dsh_home/plugins/ai-accounts"
          run install -m 600 "$source_profile/ai-accounts.json" "$accounts_file"
        fi
        run ${pkgs.python3}/bin/python3 "${profileSync}" \
          "$profile" \
          "$source_profile/package.json" \
          "$source_profile/cordis.patch.yml"
      '';
      home.file.".dsh/AGENTS.md".source =
        config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/AGENTS.md";
      home.file.".local/bin/dsh-web".source = ../assets/dsh/start-dsh;
      home.file.".local/bin/dsh-web-supervisor.mjs".source = ../assets/dsh/supervise-web.mjs;
      home.file.".local/bin/dsh-ensure-controller-patch.mjs".source =
        ../assets/dsh/ensure-controller-patch.mjs;
      home.file.".local/bin/dsh-start".source = dshStartAlias;
      home.shellAliases.dshstart = "dsh-start";

      # `dsh lkg` starts the last known good snapshot instead of the live
      # installation. The recovery script is self-contained: it reads only the
      # snapshot store, never the repository, the pnpm global install or the live
      # ~/.dsh profile, so it still works after an agent breaks the main install.
      # Every other subcommand delegates to the real CLI unchanged.
      programs.zsh.initContent = lib.mkAfter ''
        dsh() {
          case "''${1:-}" in
            lkg)
              shift
              exec "$HOME/.local/bin/dsh-recover" "$@"
              ;;
            *)
              command dsh "$@"
              ;;
          esac
        }
      '';

      # The bundle is a directory, which Home Manager cannot link: its
      # activation only emits regular files and symlinks, and its comparison
      # helpers abort with "Is a directory". Registering it with macos-apps
      # rsync-copies it into ~/Applications like every other GUI app here.
      macosAppSources."DeepSeek Harness.app" = "${dshApp}";
    };
}
