{
  description = "Alex's nixfiles";

  nixConfig = {
    extra-substituters = [
      "https://cache.numtide.com"
      "https://devenv.cachix.org"
      "https://cachix.cachix.org"
    ];
    extra-trusted-public-keys = [
      "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
      "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw="
      "cachix.cachix.org-1:eWNHQldwUO7G2VkjpnjDbWwy4KQ/HNxht7H4SSoMckM="
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

    # Use devenv's official Cachix-backed package instead of rebuilding its
    # Rust workspace from nixpkgs on every profile switch.
    devenv = {
      url = "github:cachix/devenv/v2.3.1";
    };

    llm-agents = {
      url = "github:numtide/llm-agents.nix";
    };

    # qmd: on-device markdown/code search backend used by pi-memory.
    # Upstream maintains its own flake incl. per-system node_modules hashes;
    # intentionally NOT following our nixpkgs (node-gyp/bun combo as tested
    # upstream).
    qmd = {
      url = "github:tobi/qmd";
    };

    # shiftshift is a private, local-first app repo; SSH keeps the input
    # usable without putting GitHub credentials in the flake.
    shiftshift = {
      url = "git+ssh://git@github.com/astahmer/shiftshift-app.git?ref=main";
    };

    # Tokitoki's source flake provides the reproducible Bun/CLI package. The
    # local Home Manager module below adds secret-backed config and the macOS
    # menu-bar LaunchAgent on top of that package.
    tokitoki = {
      url = "github:astahmer/tokitoki";
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
      ++ [ (inputs.import-tree ./modules) ]
      ++ [ (inputs.import-tree ./hosts) ];

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

          nixfilesConfigureNixCache = pkgs'.writeShellApplication {
            name = "nixfiles-configure-nix-cache";
            runtimeInputs = [
              pkgs'.coreutils
              pkgs'.gawk
              pkgs'.gnugrep
              pkgs'.nix
            ];
            text = builtins.readFile ./scripts/configure-nix-cache.sh;
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
            calldiff = pkgs'.callPackage ./packages/calldiff { };
            codex = pkgs'.callPackage ./packages/codex { };
            configure-nix-cache = nixfilesConfigureNixCache;
            # The upstream flake patches nixpkgs as an evaluation input. That
            # output cannot be realised for a foreign system during cross-checks
            # (for example, evaluating the Linux host from this Mac). The
            # standalone macOS profile is the target that needs the cache-backed
            # binary; keep the nixpkgs package for the foreign Linux check.
            devenv =
              if system == "aarch64-darwin" then inputs.devenv.packages.${system}.devenv else pkgs'.devenv;
            drydock = pkgs'.callPackage ./packages/drydock { };
            hunk = pkgs'.callPackage ./packages/hunk { pkgs = pkgs'; };
            iris = pkgs'.callPackage ./packages/iris { };
            lightjj = pkgs'.callPackage ./packages/lightjj { pkgs = pkgs'; };
            mise = pkgs'.callPackage ./packages/mise { };
            modlens = pkgs'.callPackage ./packages/modlens { };
            modsearch = pkgs'.callPackage ./packages/modsearch { };
            nub = pkgs'.callPackage ./packages/nub { };
            nh = pkgs'.callPackage ./packages/nh { };
            opencode = inputs.llm-agents.packages.${system}.opencode;
            qmd = inputs.qmd.packages.${system}.default;
            pi-watchdog = pkgs'.callPackage ./packages/pi-watchdog { };
            opencode2 = inputs.llm-agents.packages.${system}.opencode2;
            opencodex = pkgs'.callPackage ./packages/opencodex { pkgs = pkgs'; };
            plannotator = pkgs'.callPackage ./packages/plannotator { pkgs = pkgs'; };
            ryu = pkgs'.callPackage ./packages/ryu { };
            secret = pkgs'.callPackage ./packages/secret { };
            tokitoki = pkgs'.callPackage ./packages/tokitoki {
              tokitokiSource = inputs.tokitoki;
            };
            zed = pkgs'.callPackage ./packages/zed { };
          }
          // pkgs.lib.optionalAttrs (system == "aarch64-darwin") {
            claude-desktop = pkgs'.callPackage ./packages/claude-desktop { };
            crisp = pkgs'.callPackage ./packages/crisp { };
            discord-bin = pkgs'.callPackage ./packages/discord-bin { };
            ghui = pkgs'.callPackage ./packages/ghui { pkgs = pkgs'; };
            notunes = pkgs'.callPackage ./packages/notunes { };
            pen-dev = pkgs'.callPackage ./packages/pen-dev { };
            recordly = pkgs'.callPackage ./packages/recordly { };
            secretbar = pkgs'.callPackage ./packages/secretbar { };
            shiftshift =
              let
                version = (builtins.fromJSON (builtins.readFile "${inputs.shiftshift}/package.json")).version;
              in
              pkgs'.callPackage ./packages/shiftshift {
                pkgs = pkgs';
                shiftshiftNixpkgs = inputs.shiftshift.inputs.nixpkgs;
                shiftshiftRustOverlay = inputs.shiftshift.inputs.rust-overlay.overlays.default;
                shiftshiftSource = inputs.shiftshift;
                shiftshiftIcon = "${inputs.shiftshift}/src-tauri/icons/icon.icns";
                inherit version;
              };
            t3code-bin = pkgs'.callPackage ./packages/t3code-bin { };
            tokitoki-menubar = pkgs'.callPackage ./packages/tokitoki-menubar {
              tokitokiSource = inputs.tokitoki;
            };
            tidyports = pkgs'.callPackage ./packages/tidyports { };
            tldraw-offline = pkgs'.callPackage ./packages/tldraw-offline { };
            whatsapp-bin = pkgs'.callPackage ./packages/whatsapp-bin { };
          };
          apps.configure-nix-cache = {
            type = "app";
            program = "${nixfilesConfigureNixCache}/bin/nixfiles-configure-nix-cache";
            meta.description = "Configure macOS Nix binary caches before an apply";
          };
          apps.update-pins = mkBunApp "update-pins" ./scripts/update-pins.ts;
        };
    };
}
