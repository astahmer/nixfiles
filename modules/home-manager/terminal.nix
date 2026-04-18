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
        };
      })

      (lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin) {
        programs.kitty = {
          enable = true;
          settings = {
            font_size = lib.mkDefault 12;
            enable_audio_bell = lib.mkDefault false;
            confirm_os_window_close = lib.mkDefault 0;
            window_padding_width = lib.mkDefault 4;
          };
        };
      })
    ];
}
