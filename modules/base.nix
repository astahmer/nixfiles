{ config, ... }:
let
  flakeConfig = config;
  username = flakeConfig.nixfiles.username;
in
{
  config.flake.modules.homeManager.base =
    { config, ... }:
    {
      home.stateVersion = flakeConfig.nixfiles.homeStateVersion;

      home.sessionPath = [
        "${config.home.profileDirectory}/bin"
        "/nix/var/nix/profiles/default/bin"
        "${config.home.homeDirectory}/.local/share/pnpm"
        "${config.home.homeDirectory}/.local/bin"
      ];

      home.sessionVariables = {
        EDITOR = "nvim";
        VISUAL = "nvim";
        PNPM_HOME = "${config.home.homeDirectory}/.local/share/pnpm";
        PNPM_STORE_DIR = "${config.home.homeDirectory}/.local/share/pnpm/store";
      };

      programs.home-manager.enable = true;

      xdg.enable = true;
    };

  config.flake.modules.nixos.base =
    { pkgs, ... }:
    {
      boot.loader.efi.canTouchEfiVariables = true;
      boot.loader.systemd-boot.enable = true;

      networking.networkmanager.enable = true;

      nix.settings.experimental-features = [
        "nix-command"
        "flakes"
      ];
      # Keep the Numtide cache available for the pinned binary packages from
      # llm-agents.nix when this host applies the configuration.
      nix.settings.extra-substituters = [ "https://cache.numtide.com" ];
      nix.settings.extra-trusted-public-keys = [
        "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
      ];
      # Permit the normal login user to use the additional substituter on this
      # single-user machine; root remains trusted for system operations.
      nix.settings.trusted-users = [
        "root"
        username
      ];
      nix.gc = {
        automatic = true;
        dates = "weekly";
        options = "--delete-older-than 30d";
      };
      nixpkgs.config.allowUnfree = true;

      programs.zsh.enable = true;
      users.defaultUserShell = pkgs.zsh;

      users.users.${username} = {
        isNormalUser = true;
        extraGroups = [
          "networkmanager"
          "wheel"
        ];
      };

      system.stateVersion = flakeConfig.nixfiles.nixosStateVersion;
    };
}
