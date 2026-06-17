{ ... }:
{
  config.flake.modules.homeManager.shell =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      pnpmHome = "${config.home.homeDirectory}/.local/share/pnpm";
      pnpmBin = "${pnpmHome}/bin";

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
                  local search_mode="present"
                  local from="main@origin"
                  local to="@"
                  local pattern

                  while [[ $# -gt 0 ]]; do
                    case "$1" in
                      -r|--regex)
                        mode="regex"
                        shift
                        ;;
                      --history)
                        search_mode="history"
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
        Usage: jjsearch [--history] [--regex] [--from REVSET] [--to REVSET] PATTERN

        Defaults: --from main@origin --to @
        Default search mode: only lines still present in --to
        Use --history to search each commit in the range
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

                  if [[ "$search_mode" == "history" ]]; then
                    jj log -G -r "changes($from, $to)" -p --git | awk -v pattern="$pattern" -v mode="$mode" -v search_mode="$search_mode" '
                    function matches(line) {
                      if (mode == "regex") {
                        return line ~ pattern
                      }

                      return index(line, pattern)
                    }

                    function column(line) {
                      if (mode == "regex") {
                        match(line, pattern)
                        return RSTART
                      }

                      return index(line, pattern)
                    }

                    function hunk_start(header,   range, parts) {
                      if (match(header, /\+[0-9]+(,[0-9]+)?/)) {
                        range = substr(header, RSTART + 1, RLENGTH - 1)
                        split(range, parts, ",")

                        return parts[1]
                      }

                      return 0
                    }

                    function emit_location(col) {
                      if (search_mode == "history") {
                        printf "%s %s:%d:%d\n", rev, file, new_line, col
                        return
                      }

                      printf "%s:%d:%d\n", file, new_line, col
                    }

                    search_mode == "history" && NF >= 5 && $3 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
                      rev = $1
                      file = ""
                      in_hunk = 0
                      next
                    }

                    $1 == "diff" && $2 == "--git" {
                      file = $4
                      sub(/^b\//, "", file)
                      in_hunk = 0
                      next
                    }

                    /^@@ / {
                      new_line = hunk_start($0)
                      in_hunk = 1
                      next
                    }

                    in_hunk && substr($0, 1, 1) == "-" {
                      next
                    }

                    in_hunk && substr($0, 1, 1) == " " {
                      new_line++
                      next
                    }

                    in_hunk && substr($0, 1, 1) == "+" {
                      line = substr($0, 2)

                      if (matches(line)) {
                        col = column(line)

                        if (col < 1) {
                          col = 1
                        }

                        emit_location(col)
                        print "+" line
                      }

                      new_line++
                    }
                  '
                  else
                    jj diff --from "$from" --to "$to" --git | awk -v pattern="$pattern" -v mode="$mode" -v search_mode="$search_mode" '
                    function matches(line) {
                      if (mode == "regex") {
                        return line ~ pattern
                      }

                      return index(line, pattern)
                    }

                    function column(line) {
                      if (mode == "regex") {
                        match(line, pattern)
                        return RSTART
                      }

                      return index(line, pattern)
                    }

                    function hunk_start(header,   range, parts) {
                      if (match(header, /\+[0-9]+(,[0-9]+)?/)) {
                        range = substr(header, RSTART + 1, RLENGTH - 1)
                        split(range, parts, ",")

                        return parts[1]
                      }

                      return 0
                    }

                    function emit_location(col) {
                      printf "%s:%d:%d\n", file, new_line, col
                    }

                    $1 == "diff" && $2 == "--git" {
                      file = $4
                      sub(/^b\//, "", file)
                      in_hunk = 0
                      next
                    }

                    /^@@ / {
                      new_line = hunk_start($0)
                      in_hunk = 1
                      next
                    }

                    in_hunk && substr($0, 1, 1) == "-" {
                      next
                    }

                    in_hunk && substr($0, 1, 1) == " " {
                      new_line++
                      next
                    }

                    in_hunk && substr($0, 1, 1) == "+" {
                      line = substr($0, 2)

                      if (matches(line)) {
                        col = column(line)

                        if (col < 1) {
                          col = 1
                        }

                        emit_location(col)
                        print "+" line
                      }

                      new_line++
                    }
                  '
                  fi
                }
      '';
    in
    {
      home.packages = [
        pkgs.nodejs_24
        pkgs.rtk
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.llvmPackages.libcxxClang ];

      programs.bash.enable = true;
      programs.zsh.enable = true;
      programs.zsh.dotDir = "${config.xdg.configHome}/zsh";

      home.sessionVariables.HISTFILE = "${config.xdg.configHome}/zsh/.zsh_history";

      home.activation.ensureZshHistoryFile = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        mkdir -p "${config.xdg.configHome}/zsh"
        touch "${config.xdg.configHome}/zsh/.zsh_history"
      '';

      home.activation.skepsisCheckout = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        deps_dir="${config.home.homeDirectory}/dev/deps"
        skepsis_dir="$deps_dir/skepsis"

        if [ ! -d "$skepsis_dir" ]; then
          $DRY_RUN_CMD mkdir -p "$deps_dir"
          $DRY_RUN_CMD ${lib.getExe pkgs.git} clone https://github.com/oxidecomputer/skepsis.git "$skepsis_dir"
        fi

        if [ -f "$skepsis_dir/package.json" ] && [ ! -d "$skepsis_dir/node_modules" ]; then
          $DRY_RUN_CMD sh -c 'cd "$1" && "$2" pnpm i' sh "$skepsis_dir" "${pkgs.nodejs_24}/bin/corepack"
        fi
      '';

      home.activation.aiCliInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        export PNPM_HOME="${pnpmHome}"
        export PATH="${pnpmBin}:$PATH"
        export COREPACK_ENABLE_AUTO_PIN=0

        mkdir -p "${pnpmHome}"

        if ! command -v composto >/dev/null 2>&1; then
          $DRY_RUN_CMD "${pkgs.nodejs_24}/bin/corepack" enable >/dev/null 2>&1 || true
          $DRY_RUN_CMD "${pkgs.nodejs_24}/bin/corepack" pnpm add -g composto-ai@0.7.0 --allow-build=better-sqlite3 || true
        fi
      '';

      home.activation.writeGithubToken = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        token="$(cat "${config.home.homeDirectory}/.config/opencode/github-token" 2>/dev/null || true)"

        if [ -z "$token" ]; then
          token="''${GITHUB_TOKEN:-}"
        fi

        if [ -z "$token" ]; then
          token="''${GH_TOKEN:-}"
        fi

        if [ -z "$token" ] && command -v gh >/dev/null 2>&1; then
          token="$(gh auth token 2>/dev/null || true)"
        fi

        if [ -n "$token" ]; then
          mkdir -p "${config.home.homeDirectory}/.config/opencode"
          printf '%s' "$token" > "${config.home.homeDirectory}/.config/opencode/github-token"
        fi
      '';

      home.file.".config/opencode/opencode.json".text =
        builtins.replaceStrings
          [ "Bearer {env:GITHUB_TOKEN}" ]
          [ "Bearer {file:${config.home.homeDirectory}/.config/opencode/github-token}" ]
          (builtins.readFile ../assets/.config/opencode/opencode.json);
      home.file.".cursor/mcp.json".text =
        builtins.replaceStrings
          [ "Bearer {env:GITHUB_TOKEN}" ]
          [ "Bearer {file:${config.home.homeDirectory}/.config/opencode/github-token}" ]
          (builtins.readFile ../assets/.cursor/mcp.json);
      home.file.".vscode/mcp.json".source = ../assets/vscode/mcp.json;
      home.file."Library/Application Support/Code/User/mcp.json".source = ../assets/vscode/mcp.json;
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
              export PNPM_HOME="${pnpmHome}"
              export PATH="${pnpmBin}:$PATH"

              shopt -s histappend
              PROMPT_COMMAND="''${PROMPT_COMMAND:+$PROMPT_COMMAND; }history -a; history -n"

              export COREPACK_ENABLE_AUTO_PIN=0
              "${pkgs.nodejs_24}/bin/corepack" enable >/dev/null 2>&1 || true
              "${pkgs.nodejs_24}/bin/corepack" prepare pnpm@11.6.0 --activate >/dev/null 2>&1 || true

              eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
        export PATH="${pnpmBin}:$PATH"
              ${jjsearchFunction}
              ${shellAliasesFunction}
              eval "$(${lib.getExe jjPackage} util completion bash)"
      '';

      programs.zsh.initContent = lib.mkMerge [
        (lib.mkBefore ''
          ${nixPathSetup}
          export PNPM_HOME="${pnpmHome}"
          export PATH="${pnpmBin}:$PATH"

          setopt APPEND_HISTORY
          setopt INC_APPEND_HISTORY
          setopt SHARE_HISTORY

          bindkey -e

          kill-port() {
            local port="$1"

            if [[ -z "$port" ]]; then
              echo "Usage: kill-port <port>"
              return 1
            fi

            lsof -ti:$port | xargs kill -9 2>/dev/null && echo "Killed process on port $port" || echo "No process found on port $port"
          }

          export COREPACK_ENABLE_AUTO_PIN=0
          "${pkgs.nodejs_24}/bin/corepack" enable >/dev/null 2>&1 || true
          "${pkgs.nodejs_24}/bin/corepack" prepare pnpm@11.6.0 --activate >/dev/null 2>&1 || true

          eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell zsh)"
          export PATH="${pnpmBin}:$PATH"
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
        nixcheck = "nix-instantiate --parse $(git ls-files '*.nix') >/dev/null";
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
        # https://github.com/oxidecomputer/skepsis
        sk = "${lib.getExe pkgs.nodejs_24} ${config.home.homeDirectory}/dev/deps/skepsis/cli.ts";
        jjpush = "jj push";
        pnpmi = "pnpm i";
        ts = ", tsgo --noEmit";
        ai = "gh copilot suggest -t shell";
        caveman-init = "npx -y github:JuliusBrussee/caveman -- --with-init";
        nts = "node --no-warnings=ExperimentalWarning --experimental-strip-types --experimental-transform-types --env-file-if-exists=.env";
      };
    };
}
