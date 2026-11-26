{ ... }:
{
  # Local dev CLIs run from a checkout's live source: see docs/dev-clis.md.
  config.flake.modules.homeManager.devClis =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      home = config.home.homeDirectory;
      expandHome = path: if lib.hasPrefix "~/" path then home + lib.removePrefix "~" path else path;
      envName = name: lib.toUpper (lib.replaceStrings [ "-" ] [ "_" ] name);
      completionDir = "${config.xdg.stateHome}/dev-clis/zsh";

      settings =
        name: cli:
        lib.concatStringsSep "\n" [
          "name=${lib.escapeShellArg name}"
          "default_checkout=${lib.escapeShellArg (expandHome cli.checkout)}"
          "checkout_env=${envName name}_CHECKOUT"
          "fallback_node=${pkgs.nodejs_24}/bin/node"
          "fallback_node_major=${lib.versions.major pkgs.nodejs_24.version}"
        ];

      cliPackages =
        name: cli:
        let
          launcher = pkgs.writeShellApplication {
            inherit name;
            text = lib.concatStringsSep "\n" [
              (settings name cli)
              "entry=${lib.escapeShellArg cli.entry}"
              "update_env=${envName name}_UPDATE_COMMAND"
              (builtins.readFile ../assets/dev-clis/common.sh)
              (builtins.readFile ../assets/dev-clis/launcher.sh)
            ];
          };
          update = pkgs.writeShellApplication {
            name = "${name}-update";
            text = lib.concatStringsSep "\n" [
              (settings name cli)
              "repo=${lib.escapeShellArg (if cli.repo == null then "" else expandHome cli.repo)}"
              "track=${lib.escapeShellArg (if cli.track == null then "" else cli.track)}"
              "launcher=${launcher}/bin/${name}"
              "completion_args=(${lib.escapeShellArgs cli.completions})"
              "completion_dir=${lib.escapeShellArg completionDir}"
              (builtins.readFile ../assets/dev-clis/common.sh)
              (builtins.readFile ../assets/dev-clis/update.sh)
            ];
          };
        in
        [
          launcher
          update
        ];

      withCompletions = lib.filterAttrs (_: cli: cli.completions != [ ]) config.devClis;
    in
    {
      options.devClis = lib.mkOption {
        default = { };
        description = "Local dev CLIs exposed on PATH from a checkout's live source, one attribute per command.";
        type = lib.types.attrsOf (
          lib.types.submodule {
            options = {
              checkout = lib.mkOption {
                type = lib.types.str;
                description = "Checkout the command runs (`~/` allowed); `<NAME>_CHECKOUT` overrides it per call.";
              };
              entry = lib.mkOption {
                type = lib.types.str;
                description = "Entry file relative to the checkout, run with the checkout's Node.";
              };
              repo = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "jj repository `<name>-update` adds the checkout to as a workspace when it is missing.";
              };
              track = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "jj revset `<name>-update` fetches and moves the checkout onto (for example main@origin).";
              };
              completions = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [ ];
                description = "Arguments that print the command's zsh completion; `<name>-update` caches the output.";
              };
            };
          }
        );
      };

      config = {
        home.packages = lib.concatLists (lib.mapAttrsToList cliPackages config.devClis);

        # An absolute autoload plus compdef registers the cached completion
        # without invalidating the `compinit -C` dump.
        programs.zsh.initContent = lib.mkIf (withCompletions != { }) (
          lib.mkAfter (
            lib.concatStrings (
              lib.mapAttrsToList (name: _: ''
                if [[ -r ${completionDir}/_${name} ]]; then
                  autoload -Uz ${completionDir}/_${name} && compdef _${name} ${name}
                fi
              '') withCompletions
            )
          )
        );
      };
    };
}
