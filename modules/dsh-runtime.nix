{ ... }:
{
  # Headless DSH runtime for a Linux host that another machine's @dshfiles/multi-host reaches over SSH.
  # Like the Mac (modules/dsh.nix), the dsh CLI is the pnpm global `@deepseek-ai/dsh` run on fnm's official
  # Node, and the web profile links the plugins of the dshfiles checkout. This module owns the toolchain and the
  # service; the user data stays a one-time bootstrap, as on the Mac:
  #   fnm install v24.11.1
  #   jj git clone --colocate https://github.com/astahmer/dshfiles.git ~/dev/dshfiles
  #   cd ~/dev/dshfiles && pnpm install --frozen-lockfile && pnpm run build
  #   pnpm add -g @deepseek-ai/dsh@<the dshfiles catalog version>   (with fnm's Node first on PATH)
  # then `systemctl --user restart dsh-runtime`.
  config.flake.modules.homeManager.dshRuntime =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.dshRuntime;
      home = config.home.homeDirectory;
      dshHome = "${home}/.dsh";
      start = pkgs.writeShellScript "dsh-runtime-start" ''
        set -eu
        ${pkgs.coreutils}/bin/mkdir -p "$DSH_HOME/logs"
        exec >>"$DSH_HOME/logs/multi-host-web.log" 2>&1
        node_bin="''${XDG_DATA_HOME:-$HOME/.local/share}/fnm/node-versions/${cfg.nodeVersion}/installation/bin"
        if [ ! -x "$node_bin/node" ]; then
          echo "dsh-runtime: no official Node ${cfg.nodeVersion}; run: fnm install ${cfg.nodeVersion}" >&2
          exit 1
        fi
        # Official Node first (DSH cannot boot on the Nix build), then the pnpm global bin with dsh, then jj and
        # git for jj-integration; the Home Manager profile goes last so its node never shadows fnm's.
        PATH="$node_bin:${home}/.local/share/pnpm/bin:${pkgs.git}/bin:${config.programs.jujutsu.package}/bin:/usr/bin:/bin:${config.home.profileDirectory}/bin"
        export PATH
        # Reconcile the web profile with the checkout's seed before each start, as dsh-web does on the Mac.
        if [ -f "$DSHFILES_DIR/scripts/profile-sync.ts" ]; then
          node "$DSHFILES_DIR/scripts/profile-sync.ts" --profile ${cfg.profile} --home "$DSH_HOME" ||
            echo "dsh-runtime: profile sync failed; starting with the existing profile" >&2
        fi
        exec dsh --profile ${cfg.profile} --host 127.0.0.1 --port 0 --no-open
      '';
    in
    {
      options.dshRuntime = {
        dshfilesCheckout = lib.mkOption {
          type = lib.types.str;
          default = "${home}/dev/dshfiles";
          description = "dshfiles checkout whose plugins the runtime profile links.";
        };
        nodeVersion = lib.mkOption {
          type = lib.types.str;
          default = "v24.11.1";
          description = "fnm-installed official Node the runtime runs on; matches the dshfiles .node-version.";
        };
        profile = lib.mkOption {
          type = lib.types.str;
          default = "web";
          description = "DSH profile the runtime starts; it must include @dshfiles/multi-host.";
        };
      };

      config = {
        home.packages = [ pkgs.fnm ];
        home.sessionVariables.DSHFILES_DIR = cfg.dshfilesCheckout;
        home.file.".dsh/AGENTS.md".source = config.lib.file.mkOutOfStoreSymlink "${home}/.agents/AGENTS.md";

        # multi-host reads the tokenized loopback URL from $DSH_HOME/plugins/multi-host/launch.json (0600). The start
        # script logs to the file multi_host_runtime_logs reads, not the journal, so that URL stays in a 0600 file.
        systemd.user.services.dsh-runtime = {
          Unit = {
            Description = "Headless DeepSeek Harness runtime for multi-host";
            After = [ "network-online.target" ];
          };
          Service = {
            Type = "simple";
            WorkingDirectory = home;
            Environment = [
              "DSH_HOME=${dshHome}"
              "DSHFILES_DIR=${cfg.dshfilesCheckout}"
              "PNPM_HOME=${home}/.local/share/pnpm"
              "NODE_COMPILE_CACHE=${home}/.cache/dshfiles/node-compile-cache"
            ];
            # Provider API keys (e.g. OPENCODE_API_KEY) live in this machine-local 0600 file, never in the repo.
            EnvironmentFile = "-${home}/.config/dsh-runtime/runtime.env";
            ExecStart = "${start}";
            Restart = "on-failure";
            RestartSec = "10s";
            TimeoutStopSec = "30s";
            UMask = "0077";
          };
          Install.WantedBy = [ "default.target" ];
        };
      };
    };
}
