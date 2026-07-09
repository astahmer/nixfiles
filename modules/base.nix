{ config, ... }:
let
  flakeConfig = config;
  username = flakeConfig.flake.username;
in
{
  config.flake.modules.homeManager.base =
    { config, ... }:
    {
      home.stateVersion = flakeConfig.flake.homeStateVersion;

      home.sessionPath = [
        "${config.home.profileDirectory}/bin"
        "/nix/var/nix/profiles/default/bin"
        "${config.home.homeDirectory}/.local/share/pnpm"
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

      system.stateVersion = flakeConfig.flake.nixosStateVersion;
    };
}
