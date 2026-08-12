{ ... }:
{
  config.flake.modules.homeManager.shellInteractive =
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

      jjCompletionBash = pkgs.runCommand "jj-completion-bash" { } ''
        ${lib.getExe jjPackage} util completion bash > "$out"
      '';

      jjCompletionZsh =
        pkgs.runCommand "jj-completion-zsh"
          {
            nativeBuildInputs = [ pkgs.zsh ];
          }
          ''
            mkdir -p "$out/share/zsh/site-functions"
            ${lib.getExe jjPackage} util completion zsh > "$out/share/zsh/site-functions/_jj"
            zsh -fc 'zcompile "$1"' zcompile "$out/share/zsh/site-functions/_jj"
          '';

      starshipInitBash =
        pkgs.runCommand "starship-init-bash"
          {
            nativeBuildInputs = [ pkgs.starship ];
          }
          ''
            starship init bash --print-full-init > "$out"
          '';

      starshipInitZsh =
        pkgs.runCommand "starship-init-zsh"
          {
            nativeBuildInputs = [ pkgs.starship ];
          }
          ''
            starship init zsh > "$out"
          '';

      direnvHookBash =
        pkgs.runCommand "direnv-hook-bash"
          {
            nativeBuildInputs = [ pkgs.direnv ];
          }
          ''
            direnv hook bash > "$out"
          '';

      direnvHookZsh =
        pkgs.runCommand "direnv-hook-zsh"
          {
            nativeBuildInputs = [ pkgs.direnv ];
          }
          ''
            direnv hook zsh > "$out"
          '';

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
          source ${jjCompletionBash}
          source ${direnvHookBash}
          source ${starshipInitBash}
      '';

      programs.zsh.completionInit = ''
        fpath+=("${jjCompletionZsh}/share/zsh/site-functions")
        autoload -U compinit && compinit -C
        autoload -Uz _jj && compdef _jj jj
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
          source ${starshipInitZsh}
          source ${direnvHookZsh}
        '')
      ];

      home.shellAliases = {
        # Uses NH_FLAKE (~/.config/nixfiles → clone). No need to cd into the repo.
        nixapply = "nh home switch -c macbook -b hm-backup";
        nixswitch = "nh home switch -c macbook -b hm-backup";
        nixupdate = "nh home switch -c macbook -b hm-backup -u";
        nixbootstrap = "nixfiles-bootstrap";
        nixlint = "nixfiles-check";
        nixcheck = "nixfiles-check";
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
