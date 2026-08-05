{
  description = "Alex's nixfiles";

  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [
      "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
    ];
  };

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

    nub = {
      url = "github:nubjs/nub/v0.6.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    llm-agents = {
      url = "github:numtide/llm-agents.nix";
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

          mkBunApp =
            name: script:
            let
              runner = pkgs'.writeTextFile {
                name = name;
                destination = "/bin/${name}";
                executable = true;
                text = ''
                  #!${pkgs'.lib.getExe pkgs'.bun}
                  await import("file://${script}");
                '';
              };
            in
            {
              type = "app";
              program = "${runner}/bin/${name}";
              meta.description = "Run the ${name} maintenance app";
            };
        in
        {
          formatter = pkgs.nixfmt;

          devShells.default = pkgs'.mkShell {
            packages = [
              pkgs'.deadnix
              pkgs'.nixfmt
            ];
          };

          packages = {
            agy = pkgs'.callPackage ./packages/agy { };
            codex = pkgs'.callPackage ./packages/codex { };
            drydock = pkgs'.callPackage ./packages/drydock { };
            hunk = pkgs'.callPackage ./packages/hunk { pkgs = pkgs'; };
            iris = pkgs'.callPackage ./packages/iris { };
            lightjj = pkgs'.callPackage ./packages/lightjj { pkgs = pkgs'; };
            modlens = pkgs'.callPackage ./packages/modlens { };
            modsearch = pkgs'.callPackage ./packages/modsearch { };
            nub = inputs.nub.packages.${system}.default;
            opencode = inputs.llm-agents.packages.${system}.opencode;
            opencodex = pkgs'.callPackage ./packages/opencodex { pkgs = pkgs'; };
            plannotator = pkgs'.callPackage ./packages/plannotator { pkgs = pkgs'; };
            ryu = pkgs'.callPackage ./packages/ryu { };
          }
          // pkgs.lib.optionalAttrs (system == "aarch64-darwin") {
            ghui = pkgs'.callPackage ./packages/ghui { pkgs = pkgs'; };
          }
          // pkgs.lib.optionalAttrs (pkgs.lib.elem system pkgs.lib.platforms.darwin) {
            secret-unlock-helper = pkgs'.callPackage ./packages/secret-unlock-helper { };
          };

          apps.update-pins = mkBunApp "update-pins" ./scripts/update-pins.ts;
        };
    };
}
