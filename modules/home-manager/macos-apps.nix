{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, ... }:
    {
      # macOS app installation is disabled by default here to avoid
      # evaluating platform-unsupported packages during aarch64-darwin builds.
      home.packages = [];
      #  home.packages = [
      #   pkgs.orbstack
      #   pkgs.slack
      #   pkgs.spotify
      #   pkgs.shottr
      #   pkgs."whatsapp-for-mac"
      # ];
    };
}
