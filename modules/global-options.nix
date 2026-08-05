{ lib, ... }:
{
  # Scalars live outside `config.flake` so flake-parts does not export them as
  # top-level flake outputs; only `modules`, `homeConfigurations`, and
  # `nixosConfigurations` belong under `config.flake`.
  options.nixfiles.username = lib.mkOption {
    type = lib.types.str;
    default = "astahmer";
    description = "Primary username shared by the macOS and NixOS setups.";
  };

  options.nixfiles.nixosHostName = lib.mkOption {
    type = lib.types.str;
    default = "workstation";
    description = "Name used for the NixOS host and its flake output.";
  };

  options.nixfiles.macHomeName = lib.mkOption {
    type = lib.types.str;
    default = "macbook";
    description = "Name used for the standalone Home Manager profile.";
  };

  options.nixfiles.nixosSystem = lib.mkOption {
    type = lib.types.str;
    default = "x86_64-linux";
    description = "System string for the NixOS host.";
  };

  options.nixfiles.macSystem = lib.mkOption {
    type = lib.types.str;
    default = "aarch64-darwin";
    description = "System string for the macOS Home Manager profile.";
  };

  options.nixfiles.homeStateVersion = lib.mkOption {
    type = lib.types.str;
    default = "25.11";
    description = "Home Manager state version.";
  };

  options.nixfiles.nixosStateVersion = lib.mkOption {
    type = lib.types.str;
    default = "25.11";
    description = "NixOS state version.";
  };

}
