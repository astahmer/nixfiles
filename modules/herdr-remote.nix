{ ... }:
{
  # Remote-agent support for macOS machines sharing the macbook profile:
  # a headless herdr server is always available so other machines can attach
  # with `herdr --remote <host>` (over Tailscale + ssh) at any time.
  config.flake.modules.homeManager.herdrRemote =
    { pkgs, ... }:
    let
      # No-op when a server is already running (an interactive `herdr`
      # attach starts its own), so enabling this on every machine sharing
      # the profile is safe. KeepAlive.SuccessExit=false restarts only after
      # abnormal exits — `herdr server stop` keeps it stopped.
      herdrServerStarter = pkgs.writeShellScript "herdr-server-starter" ''
        if ${pkgs.herdr}/bin/herdr status 2>/dev/null | grep -q 'compatible: yes'; then
          exit 0
        fi
        exec ${pkgs.herdr}/bin/herdr server
      '';
    in
    {
      launchd.agents.herdr-server = {
        enable = true;
        config = {
          ProgramArguments = [ "${herdrServerStarter}" ];
          RunAtLoad = true;
          KeepAlive.SuccessfulExit = false;
        };
      };
    };
}
