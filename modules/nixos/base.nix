{ config, ... }:
let
  username = config.flake.username;
in
{
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

      system.stateVersion = config.flake.nixosStateVersion;
    };
}
