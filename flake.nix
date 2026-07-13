{
  description = "Alex's nixfiles";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    flake-parts.url = "github:hercules-ci/flake-parts";

    import-tree.url = "github:vic/import-tree";

    nix-index-database = {
      url = "github:nix-community/nix-index-database";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];

      imports = [
        inputs.flake-parts.flakeModules.modules
        inputs.home-manager.flakeModules.home-manager
      ]
      ++ (inputs.import-tree ./modules).imports
      ++ (inputs.import-tree ./hosts).imports;

      perSystem =
        { pkgs, system, ... }:
        let
          pkgs' = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
        in
        {
          formatter = pkgs.nixfmt;

          packages = {
            ghui = import ./packages/ghui.nix { pkgs = pkgs'; };
            hunk = import ./packages/hunk.nix { pkgs = pkgs'; };
            lightjj = import ./packages/lightjj.nix { pkgs = pkgs'; };
            nub = import ./packages/nub.nix { pkgs = pkgs'; };
            plannotator = import ./packages/plannotator.nix { pkgs = pkgs'; };
            ryu = import ./packages/ryu.nix { pkgs = pkgs'; };
          };
        };
    };
}
