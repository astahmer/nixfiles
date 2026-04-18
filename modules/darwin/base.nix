{ config, ... }:
let
  username = config.flake.username;
in
{
  config.flake.modules.darwin.base =
    { pkgs, ... }:
    {
      programs.zsh.enable = true;

      services.nix-daemon.enable = true;

      nix.settings.experimental-features = [
        "nix-command"
        "flakes"
      ];
      nixpkgs.config.allowUnfree = true;

      system.primaryUser = username;
      system.stateVersion = config.flake.darwinStateVersion;

      users.users.${username} = {
        home = "/Users/${username}";
        shell = pkgs.zsh;
      };
    };
}