{ config, ... }:
{
  config.flake.modules.homeManager.shell =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      nixProfileBins = [
        "${config.home.profileDirectory}/bin"
        "/nix/var/nix/profiles/default/bin"
      ];

      nixPathSetup = ''
        export PATH="${lib.concatStringsSep ":" nixProfileBins}:$PATH"
      '';

      jjPackage =
        if config.programs.jujutsu.package != null then config.programs.jujutsu.package else pkgs.jujutsu;

      jjsearchFunction = ''
        jjsearch() {
          local mode="fixed"
          local pattern

          case "''${1-}" in
            -r|--regex)
              mode="regex"
              shift
              ;;
          esac

          pattern="$*"

          if [[ -z "$pattern" ]]; then
            echo "Usage: jjsearch [--regex] PATTERN"
            return 2
          fi

          jj log -r 'closest_bookmark(@)::@' -p --git | awk -v pattern="$pattern" -v mode="$mode" '
            function matches(line) {
              if (mode == "regex") {
                return line ~ pattern
              }

              return index(line, pattern)
            }

            $1 == "@" || $1 == "○" {
              rev = $2
              next
            }

            $2 == "diff" && $3 == "--git" {
              file = $5
              sub(/^b\//, "", file)
              next
            }

            $2 == "+" {
              line = substr($0, index($0, "+"))

              if (matches(line)) {
                key = rev SUBSEP file

                if (key != last_key) {
                  printf "%s %s\n", rev, file
                  last_key = key
                }

                print line
              }
            }
          '
        }
      '';
    in
    {
      programs.bash.enable = true;
      programs.zsh.enable = true;
      programs.zsh.dotDir = "${config.xdg.configHome}/zsh";

      home.sessionVariables.HISTFILE = "${config.xdg.configHome}/zsh/.zsh_history";

      home.activation.ensureZshHistoryFile = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        mkdir -p "${config.xdg.configHome}/zsh"
        touch "${config.xdg.configHome}/zsh/.zsh_history"
      '';

      home.file.".zshenv".text = ''
        [[ -f "$HOME/.config/zsh/.zshenv" ]] && source "$HOME/.config/zsh/.zshenv"
      '';

      home.file.".zprofile".text = ''
        [[ -f "$HOME/.config/zsh/.zprofile" ]] && source "$HOME/.config/zsh/.zprofile"
      '';

      home.file.".zshrc".text = ''
        [[ -f "$HOME/.config/zsh/.zshrc" ]] && source "$HOME/.config/zsh/.zshrc"
      '';

      programs.starship = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
      };

      programs.starship.settings = {
        character.vicmd_symbol = "";
        command_timeout = 1000;

        aws.disabled = true;
        gcloud.disabled = true;
        azure.disabled = true;
        kubernetes.disabled = true;
        docker_context.disabled = true;
        nodejs.disabled = true;
        username.disabled = true;
        package.disabled = true;
        git_commit.disabled = true;
        git_state.disabled = true;
        git_metrics.disabled = true;

        cmd_duration = {
          min_time = 1000;
          format = "took [$duration]($style) ";
        };

        custom.jj = {
          format = "$output ";
          command = "jj-starship prompt --no-jj-prefix --no-jj-name --no-git-prefix --no-git-name";
          when = "jj-starship detect";
          ignore_timeout = true;
        };

        custom.nix = {
          symbol = "❄️ ";
          detect_files = [
            "flake.nix"
            "default.nix"
            "shell.nix"
          ];
          format = "[$symbol]($style)";
          style = "bold blue";
        };

        git_branch.disabled = true;
        git_status.disabled = true;
      };

      programs.mcfly = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
      };

      programs.direnv = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        nix-direnv.enable = true;
      };

      programs.bash.initExtra = lib.mkAfter ''
        ${nixPathSetup}

        eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
        ${jjsearchFunction}
        eval "$(${lib.getExe jjPackage} util completion bash)"
      '';

      programs.zsh.initContent = lib.mkMerge [
        (lib.mkBefore ''
          ${nixPathSetup}

          bindkey -e

          kill-port() {
            local port="$1"

            if [[ -z "$port" ]]; then
              echo "Usage: kill-port <port>"
              return 1
            fi

            lsof -ti:$port | xargs kill -9 2>/dev/null && echo "Killed process on port $port" || echo "No process found on port $port"
          }

          eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell zsh)"
          ${jjsearchFunction}
        '')

        (lib.mkAfter ''
          eval "$(${lib.getExe jjPackage} util completion zsh)"
        '')
      ];

      home.shellAliases = {
        nixapply = "nix run nixpkgs#home-manager -- switch -b hm-backup --flake .#macbook";
        nixlint = "nix run github:nix-community/nixpkgs-lint -- .";
        zshconfig = "code ~/.config/zsh/.zshrc";
        jjconfig = "code $(jj config path --user)";
        opencodeconfig = "code ~/.config/opencode/opencode.json";
        npmrc = "code ~/.npmrc";
        gitconfig = "code ~/.gitconfig";
        gitignore = "code ~/.gitignore";
        sauce = "source ~/.config/zsh/.zshrc";
        ppnm = "pnpm";
        pn = "pnpm";
        jjpush = "jj push";
        pnpmi = "pnpm i";
        ts = ", tsgo --noEmit";
        ai = "gh copilot suggest -t shell";
        nts = "node --no-warnings=ExperimentalWarning --experimental-strip-types --experimental-transform-types --env-file-if-exists=.env";
      };
    };
}
