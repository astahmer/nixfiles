{ inputs, ... }:
{
  config.flake.modules.homeManager.iris =
    { pkgs, lib, ... }:
    let
      iris = inputs.iris.packages.${pkgs.stdenv.hostPlatform.system}.default;
    in
    {
      home.packages = [ iris ];

      # `iris init` makes IRIS the shell's always-on PTY wrapper. Keep the
      # normal shell native and launch IRIS only when it is explicitly wanted.
      home.shellAliases.i = lib.getExe iris;

      home.file.".config/iris/config.toml".text = ''
        [core]
        version = 1
        shell = ""
        mode = "last"
        debug = false
        expand-alias = true
        auto-execute = false

        [ui]
        style = "modern"
        ghost-text = true
        hidden-files = false
        max-suggestions = 100
        max-height = 15
        nerd-fonts = true

        [git]
        filter-active-branch = true
        deduplicate-branches = true

        [updater]
        check-on-startup = false
        channel = "stable"
        check-interval = "24h"

        [keybindings]
        toggle-mode = "ctrl+r"
        toggle-menu = "shift+tab"
        select = "tab"
        navigate-up = "up"
        navigate-down = "down"
      '';
    };
}
