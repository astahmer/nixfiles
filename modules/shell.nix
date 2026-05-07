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

      shellAliasNames = builtins.attrNames config.home.shellAliases;
      shellAliasPattern = lib.concatStringsSep "|" (map lib.escapeRegex shellAliasNames);

      shellAliasesFunction = ''
                aliases() {
                  alias | sed -E 's/^alias //' | grep -E '^(${shellAliasPattern})='
                }
      '';

      jjsearchFunction = ''
                jjsearch() {
                  local mode="fixed"
                  local from="main@origin"
                  local to="@"
                  local pattern

                  while [[ $# -gt 0 ]]; do
                    case "$1" in
                      -r|--regex)
                        mode="regex"
                        shift
                        ;;
                      -f|--from)
                        if [[ $# -lt 2 ]]; then
                          echo "jjsearch: missing value for $1" >&2
                          return 2
                        fi

                        from="$2"
                        shift 2
                        ;;
                      -t|--to)
                        if [[ $# -lt 2 ]]; then
                          echo "jjsearch: missing value for $1" >&2
                          return 2
                        fi

                        to="$2"
                        shift 2
                        ;;
                      -h|--help)
                        cat <<'EOF'
        Usage: jjsearch [--regex] [--from REVSET] [--to REVSET] PATTERN

        Defaults: --from main@origin --to @
        EOF
                        return 0
                        ;;
                      --)
                        shift
                        break
                        ;;
                      -*)
                        echo "jjsearch: unknown option: $1" >&2
                        return 2
                        ;;
                      *)
                        break
                        ;;
                    esac
                  done

                  pattern="$*"

                  if [[ -z "$pattern" ]]; then
                    echo "jjsearch: missing search pattern" >&2
                    return 2
                  fi

                  jj log -G -r "changes($from, $to)" -p --git | awk -v pattern="$pattern" -v mode="$mode" '
                    function matches(line) {
                      if (mode == "regex") {
                        return line ~ pattern
                      }

                      return index(line, pattern)
                    }

                    NF >= 5 && $3 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
                      rev = $1
                      file = ""
                      next
                    }

                    $1 == "diff" && $2 == "--git" {
                      file = $4
                      sub(/^b\//, "", file)
                      next
                    }

                    $1 == "+" {
                      line = substr($0, 2)

                      if (matches(line)) {
                        key = rev SUBSEP file

                        if (key != last_key) {
                          printf "%s %s\n", rev, file
                          last_key = key
                        }

                        print "+" line
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
        ${shellAliasesFunction}
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
          ${shellAliasesFunction}
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
        jjaliases = "jj config list aliases --user | sed -E 's/^aliases\\.//'";
        gitaliases = "git config --global --get-regexp '^alias\\.' | sed -E 's/^alias\\.//'";
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
