{ lib, ... }:
{
  options.flake.username = lib.mkOption {
    type = lib.types.str;
    default = "astahmer";
    description = "Primary username shared by the macOS and NixOS setups.";
  };

  options.flake.nixosHostName = lib.mkOption {
    type = lib.types.str;
    default = "workstation";
    description = "Name used for the NixOS host and its flake output.";
  };

  options.flake.macHomeName = lib.mkOption {
    type = lib.types.str;
    default = "macbook";
    description = "Name used for the standalone Home Manager profile.";
  };

  options.flake.darwinHostName = lib.mkOption {
    type = lib.types.str;
    default = "macbook";
    description = "Name used for the nix-darwin host and its flake output.";
  };

  options.flake.nixosSystem = lib.mkOption {
    type = lib.types.str;
    default = "x86_64-linux";
    description = "System string for the NixOS host.";
  };

  options.flake.darwinSystem = lib.mkOption {
    type = lib.types.str;
    default = "aarch64-darwin";
    description = "System string for the nix-darwin host.";
  };

  options.flake.macSystem = lib.mkOption {
    type = lib.types.str;
    default = "aarch64-darwin";
    description = "System string for the macOS Home Manager profile.";
  };

  options.flake.homeStateVersion = lib.mkOption {
    type = lib.types.str;
    default = "25.11";
    description = "Home Manager state version.";
  };

  options.flake.nixosStateVersion = lib.mkOption {
    type = lib.types.str;
    default = "25.11";
    description = "NixOS state version.";
  };

  options.flake.darwinStateVersion = lib.mkOption {
    type = lib.types.int;
    default = 6;
    description = "nix-darwin system state version.";
  };
}
