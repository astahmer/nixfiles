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
        export PATH="${lib.concatStringsSep ":" nixProfileBins}:${config.home.homeDirectory}/.local/bin:$PATH"
      '';

      jjPackage =
        if config.programs.jujutsu.package != null then config.programs.jujutsu.package else pkgs.jujutsu;

      jjPrompt = pkgs.writeShellApplication {
        name = "jj-prompt";
        runtimeInputs = [
          jjPackage
          pkgs."jj-starship"
        ];
        text = ''
          set -euo pipefail

          jj_cmd="${lib.getExe jjPackage}"
          jj_starship="${lib.getExe pkgs."jj-starship"}"

          first_line() {
            local value="$1"
            printf '%s' "''${value%%$'\n'*}"
          }

          compact_number() {
            local value="$1"
            local rounded

            if (( value < 1000 )); then
              printf '%d' "$value"
            elif (( value < 1000000 )); then
              rounded=$(( (value + 500) / 1000 ))
              if (( rounded >= 1000 )); then
                printf '1M'
              else
                printf '%dk' "$rounded"
              fi
            elif (( value < 1000000000 )); then
              rounded=$(( (value + 500000) / 1000000 ))
              if (( rounded >= 1000 )); then
                printf '1B'
              else
                printf '%dM' "$rounded"
              fi
            else
              rounded=$(( (value + 500000000) / 1000000000 ))
              printf '%dB' "$rounded"
            fi
          }

          if [[ -n "''${NO_COLOR:-}" || "''${TERM:-}" == "dumb" ]]; then
            ansi_reset=""
            ansi_add=""
            ansi_remove=""
          else
            ansi_reset=$'\033[0m'
            ansi_add=$'\033[32m'
            ansi_remove=$'\033[31m'
          fi

          jj_starship_args=(
            prompt
            --no-jj-prefix
            --no-git-prefix
            --no-git-name
          )
          if [[ -n "''${NO_COLOR:-}" || "''${TERM:-}" == "dumb" ]]; then
            jj_starship_args+=(--no-color)
          fi

          if ! "$jj_cmd" --ignore-working-copy root >/dev/null 2>&1; then
            exec "$jj_starship" "''${jj_starship_args[@]}"
          fi

          jj_label="$("$jj_starship" "''${jj_starship_args[@]}" 2>/dev/null || true)"
          jj_label="$(first_line "$jj_label")"

          # jj-starship snapshots once; keep the aggregate diff read-only afterward.
          diff_output="$("$jj_cmd" diff --ignore-working-copy --from 'trunk()' --to @ --stat --no-pager --color=never 2>/dev/null || true)"
          shortstat="''${diff_output##*$'\n'}"
          shortstat="''${shortstat:-stat unavailable}"

          files_changed=""
          insertions=""
          deletions=""
          stat_pattern='^([0-9]+)[[:space:]]+files?[[:space:]]+changed,[[:space:]]+([0-9]+)[[:space:]]+insertions?\(\+\),[[:space:]]+([0-9]+)[[:space:]]+deletions?\(-\)$'
          if [[ "$shortstat" =~ $stat_pattern ]]; then
            files_changed="''${BASH_REMATCH[1]}"
            insertions="''${BASH_REMATCH[2]}"
            deletions="''${BASH_REMATCH[3]}"
            diff_summary="$(printf '%s files changed, %s+%s%s %s-%s%s' \
              "$files_changed" \
              "$ansi_add" "$(compact_number "$insertions")" "$ansi_reset" \
              "$ansi_remove" "$(compact_number "$deletions")" "$ansi_reset")"
          else
            diff_summary="$shortstat"
          fi

          printf '%s · %s\n' \
            "$jj_label" \
            "$diff_summary"
        '';
      };

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

      jjEvolveFunction = ''
        jje() {
          local base="$1"
          if [[ -z "$base" ]]; then
            echo "Usage: jje <base>" >&2
            return 1
          fi
          jj duplicate "$base"::@ && jj squash -f "$base"::@ -u
        }
      '';

      # Stable pointer: ~/.config/nixfiles → clone (any machine path). See nixfiles-here.
      nixfilesFlakePath = "${config.xdg.configHome}/nixfiles";

      initagentFunction = ''
        initagent() {
          local src_dir="''${HOME}/.agents"
          if [[ ! -d "$src_dir" ]]; then
            echo "initagent: source directory not found at $src_dir (run nixapply first)" >&2
            return 1
          fi
          cp "$src_dir/AGENTS.md" "$src_dir/effect.md" "$src_dir/typescript.md" .
          echo "Copied AGENTS.md, effect.md, typescript.md to $(pwd)"
        }
      '';

      nixfilesHereFunction = ''
        nixfiles-here() {
          local target="''${XDG_CONFIG_HOME:-$HOME/.config}/nixfiles"
          local src
          src="$(pwd)"
          if [[ ! -f "$src/flake.nix" ]]; then
            echo "nixfiles-here: no flake.nix in $src" >&2
            return 1
          fi
          mkdir -p "$(dirname "$target")"
          ln -sfn "$src" "$target"
          echo "Linked $target -> $src"
        }
      '';
    in
    {
      home.packages = [
        pkgs.fd
        pkgs.nh
        jjPrompt
        pkgs.nodejs_24
        pkgs.pnpm
        pkgs.rtk
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.llvmPackages.libcxxClang ];

      programs.bash.enable = true;
      programs.zsh.enable = true;
      programs.zsh.dotDir = "${config.xdg.configHome}/zsh";

      # Project toolchains (e.g. welii `mise.toml` → `.mise/bin/dev` on PATH).
      # Owns mise via home-manager-path — do not also `nix profile add nixpkgs#mise`.
      programs.mise = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
      };

      home.sessionVariables = {
        HISTFILE = "${config.xdg.configHome}/zsh/.zsh_history";
        # Clone anywhere; point ~/.config/nixfiles at it (nixfiles-here).
        NH_FLAKE = nixfilesFlakePath;
      };

      # Drop leftover `nix profile add nixpkgs#mise` before HM installs packages.
      # That package collides on bin/mise with programs.mise and aborts activation
      # after home-manager-path was already removed (broken profile / no starship).
      home.activation.removeStandaloneMise = lib.hm.dag.entryBefore [ "installPackages" ] ''
        ${nixPathSetup}
        to_remove="$(
          nix profile list --json 2>/dev/null \
            | ${lib.getExe pkgs.jq} -r '
                .elements
                | to_entries[]
                | select(.key != "home-manager-path")
                | select(any(.value.storePaths[]?; test("-mise-[0-9]")))
                | .key
              ' || true
        )"
        if [ -n "$to_remove" ]; then
          echo "Removing standalone mise from nix profile (conflicts with programs.mise):"
          while IFS= read -r name; do
            [ -n "$name" ] || continue
            echo "  $name"
            $DRY_RUN_CMD nix profile remove "$name"
          done <<< "$to_remove"
        fi
      '';

      home.activation.warnMissingNixfilesLink = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ ! -d "${nixfilesFlakePath}" ]; then
          echo "warning: NH_FLAKE missing at ${nixfilesFlakePath}" >&2
          echo "  Clone nixfiles anywhere, cd into it, then run: nixfiles-here" >&2
          echo "  (or: ln -sfn \"\$(pwd)\" ${nixfilesFlakePath})" >&2
        fi
      '';

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
          $DRY_RUN_CMD sh -c 'export PNPM_STORE_DIR="$2/store" && cd "$1" && ${lib.getExe pkgs.pnpm} i' sh "$skepsis_dir" "${pnpmHome}"
        fi
      '';

      home.activation.aiCliInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        ${nixPathSetup}
        export PNPM_HOME="${pnpmHome}"
        export PNPM_STORE_DIR="${pnpmHome}/store"
        export PATH="${pnpmBin}:${pkgs.nodejs_24}/bin:$PATH"

        mkdir -p "${pnpmHome}"
        mkdir -p "${pnpmHome}/store"

        mkdir -p "${pnpmHome}/bin"

        if ! command -v executor >/dev/null 2>&1 || ! executor --version >/dev/null 2>&1; then
          $DRY_RUN_CMD ${lib.getExe pkgs.pnpm} remove -g executor >/dev/null 2>&1 || true
          $DRY_RUN_CMD ${lib.getExe pkgs.pnpm} add -g executor || true
        fi

        if ! command -v pi >/dev/null 2>&1; then
          $DRY_RUN_CMD ${lib.getExe pkgs.pnpm} add -g @earendil-works/pi-coding-agent || true
        fi

        if ! command -v ast-outline >/dev/null 2>&1; then
          $DRY_RUN_CMD uv tool install ast-outline || true
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

      home.activation.executorSeed =
        lib.hm.dag.entryAfter [ "writeBoundary" "aiCliInstall" "writeGithubToken" ]
          ''
            export PATH="${pkgs.nodejs_24}/bin:${pnpmBin}:$PATH"

            if [ -x "${config.home.homeDirectory}/.executor/setup.ts" ]; then
              $DRY_RUN_CMD "${config.home.homeDirectory}/.executor/setup.ts" || true
            fi

            # Restart the local Executor daemon if it is running so it picks up
            # any newly installed or updated MCP server binaries.
            if command -v executor >/dev/null 2>&1; then
              $DRY_RUN_CMD executor daemon restart --base-url http://localhost:4789 >/dev/null 2>&1 || true
            fi
          '';

      home.file.".config/pnpm/config.yaml".text = ''
        packageImportMethod: clone-or-copy
        storeDir: ${pnpmHome}/store
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
          command = lib.getExe jjPrompt;
          when = "${lib.getExe pkgs."jj-starship"} detect";
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

      programs.direnv = {
        enable = true;
        nix-direnv.enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        silent = true;
        config.global = {
          hide_env_diff = true;
          warn_timeout = "0s";
        };
      };

      programs.bash.initExtra = lib.mkAfter ''
        ${nixPathSetup}
        export PNPM_HOME="${pnpmHome}"
        export PNPM_STORE_DIR="${pnpmHome}/store"
        export PATH="${pnpmBin}:$PATH"

        shopt -s histappend
        PROMPT_COMMAND="''${PROMPT_COMMAND:+$PROMPT_COMMAND; }history -a; history -n"

        ${jjsearchFunction}
        ${jjEvolveFunction}
        ${initagentFunction}
        ${nixfilesHereFunction}
        ${shellAliasesFunction}
        eval "$(${lib.getExe jjPackage} util completion bash)"
      '';

      programs.zsh.initContent = lib.mkMerge [
        (lib.mkBefore ''
          ${nixPathSetup}
          export PNPM_HOME="${pnpmHome}"
          export PNPM_STORE_DIR="${pnpmHome}/store"
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

          ${jjsearchFunction}
          ${jjEvolveFunction}
          ${initagentFunction}
          ${nixfilesHereFunction}
          ${shellAliasesFunction}
        '')

        (lib.mkAfter ''
          eval "$(${lib.getExe jjPackage} util completion zsh)"
        '')
      ];

      home.shellAliases = {
        # Uses NH_FLAKE (~/.config/nixfiles → clone). No need to cd into the repo.
        nixapply = "nh home switch -c macbook -b hm-backup";
        nixswitch = "nh home switch -c macbook -b hm-backup";
        nixupdate = "nh home switch -c macbook -b hm-backup -u";
        nixlint = "nix run github:nix-community/nixpkgs-lint -- .";
        nixcheck = "nix-instantiate --parse $(git ls-files '*.nix') >/dev/null";
        #
        zshconfig = "code ~/.config/zsh/.zshrc";
        jjconfig = "code $(jj config path --user)";
        jjaliases = "jj config list aliases --user | sed -E 's/^aliases\\.//'";
        jjpush = "jj push";
        gitaliases = "git config --global --get-regexp '^alias\\.' | sed -E 's/^alias\\.//'";
        opencodeconfig = "code ~/.config/opencode/opencode.json";
        npmrc = "code ~/.npmrc";
        gitconfig = "code ~/.gitconfig";
        gitignore = "code ~/.gitignore";
        sauce = "source ~/.config/zsh/.zshrc";
        #
        ppnm = "pnpm";
        pn = "pnpm";
        pnp = "pnpm";
        realpnpm = "${lib.getExe pkgs.pnpm}";
        pkit = "pik";
        pkil = "pik";
        pdev = "pnpm run dev";
        pnpmi = "pnpm i";
        # https://github.com/oxidecomputer/skepsis
        sk = "${lib.getExe pkgs.nodejs_24} ${config.home.homeDirectory}/dev/deps/skepsis/cli.ts";
        ts = ", tsgo --noEmit";
        ai = "gh copilot suggest -t shell";
        plan = "plannotator";
        nts = "node --no-warnings=ExperimentalWarning --experimental-strip-types --experimental-transform-types --env-file-if-exists=.env";
      };
    };
}
