{ inputs, ... }:
{
  config.flake.modules.homeManager.iris =
    { pkgs, lib, ... }:
    let
      iris = inputs.iris.packages.${pkgs.stdenv.hostPlatform.system}.default;
    in
    {
      home.packages = [ iris ];

      programs.zsh.initContent = lib.mkOrder 400 ''
        if command -v ${lib.getExe iris} >/dev/null 2>&1; then
          eval "$(${lib.getExe iris} init zsh)"
        fi
      '';

      programs.bash.initExtra = lib.mkBefore ''
        if command -v ${lib.getExe iris} >/dev/null 2>&1; then
          eval "$(${lib.getExe iris} init bash)"
        fi
      '';

      home.file.".config/iris/config.toml".text = ''
        [core]
        version = 1
        shell = ""
        mode = "last"
        debug = false
        expand-alias = true

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
      '';
    };
}
