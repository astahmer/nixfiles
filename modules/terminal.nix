{ ... }:
{
  config.flake.modules.homeManager.terminal =
    { pkgs, lib, ... }:
    lib.mkMerge [
      {
        programs.ghostty = {
          enable = true;
          # Official Ghostty.app on macOS; nixpkgs package on Linux.
          package = if pkgs.stdenv.hostPlatform.isDarwin then null else pkgs.ghostty;
          installBatSyntax = false;
          enableZshIntegration = true;
          enableBashIntegration = true;
          settings = {
            # Flexoki Dark: warmer palette, clearer ANSI contrast than Ghostty defaults,
            # without jumping to a "high contrast" / neon look.
            theme = "Flexoki Dark";
            window-width = 160;
            window-height = 35;
          };
        };
      }

      (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
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
