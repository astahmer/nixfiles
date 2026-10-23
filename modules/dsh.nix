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
          do shell script "/bin/zsh -lc " & quoted form of "exec ${startDsh}"
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
      startDsh = pkgs.replaceVarsWith {
        src = ../assets/dsh/start-dsh;
        replacements = {
          dshfilesCheckout = config.dsh.dshfilesCheckout;
          # The app bundle starts through a login shell, where /usr/bin (Apple git 2.39) precedes the Nix profile;
          # jj needs git >= 2.41 for `jj git fetch`, which the Host's jj-integration runs.
          gitBin = "${pkgs.git}/bin";
          jjBin = "${config.programs.jujutsu.package}/bin";
          # A value already in the launching environment wins, so one run can point elsewhere.
          otelEnv = lib.optionalString config.dsh.otelExport.enable ''
            OTEL_EXPORTER_OTLP_ENDPOINT="''${OTEL_EXPORTER_OTLP_ENDPOINT:-${config.dsh.otelExport.endpoint}}"
            OTEL_SERVICE_NAME="''${OTEL_SERVICE_NAME:-dshfiles}"
            export OTEL_EXPORTER_OTLP_ENDPOINT OTEL_SERVICE_NAME
          '';
        };
        isExecutable = true;
      };
      # otel-desktop-viewer comes prebuilt from cache.nixos.org (Go binary with an embedded UI); it keeps
      # telemetry in an in-memory DuckDB unless `--db <file>` is passed through. It listens on 14318/14317 because
      # the in-DSH viewer (@dshfiles/traces) owns the standard 4318; set that plugin's mode to `both` with
      # forwardUrl http://127.0.0.1:14318 to see the same telemetry here too.
      dshTraces = pkgs.writeShellApplication {
        name = "dsh-traces";
        runtimeInputs = [ pkgs.otel-desktop-viewer ];
        text = ''
          echo "dsh-traces: UI http://127.0.0.1:8000 — OTLP HTTP http://127.0.0.1:14318, gRPC 127.0.0.1:14317"
          exec otel-desktop-viewer --host 127.0.0.1 --http 14318 --grpc 14317 --browser-port 8000 "$@"
        '';
      };
    in
    {
      options.dsh.dshfilesCheckout = lib.mkOption {
        type = lib.types.str;
        default = "${config.home.homeDirectory}/dev/dshfiles";
        description = "Where the dshfiles checkout lives on this machine; hosts override it when it is elsewhere.";
      };

      # Opt-in: with it, the supervised `dsh web` (dsh-web, dsh-start, the app bundle) exports OTLP to 4318, which
      # the in-DSH traces viewer (@dshfiles/traces) receives. Point `endpoint` at http://127.0.0.1:14318 to send
      # straight to `dsh-traces` instead. Off by default so DSH never retries an endpoint nobody listens on.
      options.dsh.otelExport = {
        enable = lib.mkEnableOption "OTLP export from the supervised dsh web Host to the local traces viewer";
        endpoint = lib.mkOption {
          type = lib.types.str;
          default = "http://127.0.0.1:4318";
          description = "OTEL_EXPORTER_OTLP_ENDPOINT given to the supervised dsh web Host (OTEL_SERVICE_NAME=dshfiles).";
        };
      };

      config = {
        # dshfiles owns the web profile reconciler (scripts/profile-sync.ts); the dsh web supervisor runs it before
        # every start, so this only applies seed changes early. A failure warns: the next start retries it.
        home.activation.dshWebProfile = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          checkout="${config.dsh.dshfilesCheckout}"
          if [ ! -f "$checkout/scripts/profile-sync.ts" ]; then
            warnEcho "No dshfiles profile reconciler in $checkout; dsh web syncs the web profile once it exists."
          elif ! run env PNPM_HOME="$HOME/.local/share/pnpm" PNPM_STORE_DIR="$HOME/.local/share/pnpm/store" \
            /bin/zsh -lc 'fnm exec --using=v22.23.3 -- node "$1/scripts/profile-sync.ts" --profile web' dsh-profile-sync "$checkout"; then
            warnEcho "The dshfiles web profile sync failed; dsh web retries it on its next start."
          fi
        '';
        home.file.".dsh/AGENTS.md".source =
          config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.agents/AGENTS.md";
        home.file.".local/bin/dsh-web".source = startDsh;
        # The supervisor restarts `dsh web` when it exits unexpectedly (bounded, with backoff) and when the running
        # Host answers HTTP but lost its Session surface to a failed hot reload — every Session route then answers
        # 'active Service "sessionController" is unavailable' and each plugin API 404s, which only a restart clears.
        # Knobs: DSH_WEB_HEALTH_PROBE=off, DSH_WEB_MAX_HEALTH_RESTARTS, DSH_WEB_MAX_CRASH_RESTARTS,
        # DSH_WEB_HEALTH_PROBE_GRACE_MS/INTERVAL_MS/ATTEMPTS, DSH_WEB_CRASH_RESTART_BACKOFF_MS.
        home.file.".local/bin/dsh-web-supervisor.mjs".source = ../assets/dsh/supervise-web.mjs;
        home.file.".local/bin/dsh-start".source = dshStartAlias;
        home.shellAliases.dshstart = "dsh-start";
        home.packages = [ dshTraces ];

        # `dsh web` runs the supervised launcher, so it gets the same environment
        # as the app bundle. `dsh lkg` starts the last known good snapshot instead
        # of the live installation. The recovery script is self-contained: it reads only the
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
              web)
                shift
                "$HOME/.local/bin/dsh-web" "$@"
                ;;
              *)
                fnm exec --using=v22.23.3 -- dsh "$@"
                ;;
            esac
          }

          # dshx is built inside the dshfiles checkout, not installed globally;
          # run that build with the Node version DSH itself uses.
          dshx() {
            fnm exec --using=v22.23.3 -- node "''${DSHFILES_DIR:-${config.dsh.dshfilesCheckout}}/tooling/dshx/packages/dshx/dist/cli/bin.js" "$@"
          }
        '';

        # The bundle is a directory, which Home Manager cannot link: its
        # activation only emits regular files and symlinks, and its comparison
        # helpers abort with "Is a directory". Registering it with macos-apps
        # rsync-copies it into ~/Applications like every other GUI app here.
        macosAppSources."DeepSeek Harness.app" = "${dshApp}";

        home.sessionVariables.DSHFILES_DIR = config.dsh.dshfilesCheckout;
      };
    };
}
