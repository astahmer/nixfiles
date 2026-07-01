{ ... }:
{
  config.flake.modules.homeManager.brew =
    { pkgs, ... }:
    {
      homebrew = {
        enable = true;
        enableZshIntegration = true;

        taps = [
          "homebrew/services"
        ];

        brews = [ ];

        casks = [
          "alt-tab"
          "cleanshot"
          # "ghostty"
          "orbstack"
        ];

        onActivation = {
          cleanup = "none";
          autoUpdate = false;
          upgrade = false;
        };
      };
    };
}
