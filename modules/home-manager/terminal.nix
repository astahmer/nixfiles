{ lib, pkgs, ... }:
{
  config.flake.modules.homeManager.terminal =
    { ... }:
    lib.mkMerge [
      (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        programs.ghostty = {
          enable = true;
          enableBashIntegration = true;
          enableFishIntegration = true;
          enableZshIntegration = true;
          settings = {
            window-width = 140;
            window-height = 32;
          };
        };
      })

      (lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin) {
        programs.kitty = {
          enable = true;
          settings = {
            font_size = lib.mkDefault 12;
            enable_audio_bell = lib.mkDefault false;
            confirm_os_window_close = lib.mkDefault 0;
            remember_window_size = lib.mkDefault false;
            initial_window_width = lib.mkDefault "140c";
            initial_window_height = lib.mkDefault "32c";
            window_padding_width = lib.mkDefault 4;
          };
        };
      })
    ];
}
