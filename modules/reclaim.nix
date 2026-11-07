{ ... }:
{
  config.flake.modules.homeManager.reclaim =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.nixfiles.reclaim;
      isDarwin = pkgs.stdenv.hostPlatform.isDarwin;

      reclaim = pkgs.writeShellApplication {
        name = "nixfiles-reclaim";
        runtimeInputs = [
          pkgs.coreutils
          pkgs.findutils
          pkgs.gawk
          pkgs.nix
        ];
        text = builtins.readFile ../scripts/reclaim.sh;
      };
    in
    {
      options.nixfiles.reclaim.enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Run weekly Nix garbage collection and prune old Home Manager generations.";
      };

      config = lib.mkIf (cfg.enable && isDarwin) {
        home.packages = [ reclaim ];

        launchd.agents.nixfiles-reclaim = {
          enable = true;
          config = {
            ProgramArguments = [ "${reclaim}/bin/nixfiles-reclaim" ];
            EnvironmentVariables = {
              XDG_STATE_HOME = config.xdg.stateHome;
            };
            StartCalendarInterval = [
              {
                Weekday = 0;
                Hour = 3;
                Minute = 0;
              }
            ];
            ProcessType = "Background";
            StandardOutPath = "${config.xdg.stateHome}/nixfiles/reclaim.log";
            StandardErrorPath = "${config.xdg.stateHome}/nixfiles/reclaim.log";
          };
        };
      };
    };
}
