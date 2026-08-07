{ config, ... }:
let
  shellInteractive = config.flake.modules.homeManager.shellInteractive;
in
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

      nixfilesFlakePath = "${config.xdg.configHome}/nixfiles";

      jjPackage =
        if config.programs.jujutsu.package != null then config.programs.jujutsu.package else pkgs.jujutsu;

      bootstrap = {
        executorVersion = "1.5.35";
        piVersion = "0.81.0";
        astOutlineVersion = "1.8.2";
        skepsisRevision = "cf699d2593e270fb8767daffcd9c46c8ce539f15";
        skepsisUrl = "https://github.com/oxidecomputer/skepsis.git";
      };

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

      # Cache jj prompt output for 5s: consecutive prompts render instantly
      # instead of paying jj diff (~50-150ms) on every prompt.
      jjPromptCached = pkgs.writeShellApplication {
        name = "jj-prompt-cached";
        runtimeInputs = [
          jjPrompt
          pkgs.coreutils
        ];
        text = ''
          cache_dir="''${XDG_CACHE_HOME:-$HOME/.cache}/jj-prompt"
          mkdir -p "$cache_dir"
          cache="$cache_dir/prompt"
          ts="$cache_dir/ts"
          now="$(date +%s 2>/dev/null || true)"
          if [ -n "$now" ] && [ -f "$ts" ] && [ -f "$cache" ]; then
            old="$(cat "$ts" 2>/dev/null || true)"
            if [ -n "$old" ] && [ "$((now - old))" -lt 5 ]; then
              cat "$cache"
              exit 0
            fi
          fi
          out="$(jj-prompt 2>/dev/null || true)"
          printf '%s\n' "$out" > "$cache"
          printf '%s\n' "$now" > "$ts"
          printf '%s\n' "$out"
        '';
      };

      nixfilesBootstrap = pkgs.writeShellApplication {
        name = "nixfiles-bootstrap";
        runtimeInputs = [
          pkgs.coreutils
          pkgs.git
          pkgs.nodejs_24
          pkgs.pnpm
          pkgs.uv
        ];
        text = ''
          set -euo pipefail

          pnpm_home="''${PNPM_HOME:-$HOME/.local/share/pnpm}"
          export PNPM_HOME="$pnpm_home"
          export PNPM_STORE_DIR="''${PNPM_STORE_DIR:-$pnpm_home/store}"
          export PATH="$PNPM_HOME/bin:$PATH"

          mkdir -p "$PNPM_HOME/bin" "$PNPM_STORE_DIR"

          if ! command -v executor >/dev/null 2>&1 || [ "$(executor --version 2>/dev/null || true)" != "v${bootstrap.executorVersion}" ]; then
            pnpm remove -g executor >/dev/null 2>&1 || true
            pnpm add -g "executor@${bootstrap.executorVersion}"
          fi

          if ! command -v pi >/dev/null 2>&1 || [ "$(pi --version 2>/dev/null || true)" != "${bootstrap.piVersion}" ]; then
            pnpm remove -g @earendil-works/pi-coding-agent >/dev/null 2>&1 || true
            pnpm add -g "@earendil-works/pi-coding-agent@${bootstrap.piVersion}"
          fi

          ast_outline_version="$(ast-outline --version 2>/dev/null | head -n 1 || true)"
          if [ "$ast_outline_version" != "ast-outline ${bootstrap.astOutlineVersion}" ]; then
            uv tool install --force "ast-outline==${bootstrap.astOutlineVersion}"
          fi

          deps_dir="$HOME/dev/deps"
          skepsis_dir="$deps_dir/skepsis"
          if [ ! -d "$skepsis_dir/.git" ]; then
            if [ -e "$skepsis_dir" ]; then
              echo "nixfiles bootstrap: refusing to replace non-git directory $skepsis_dir" >&2
              exit 1
            fi
            mkdir -p "$deps_dir"
            git clone --filter=blob:none --no-checkout "${bootstrap.skepsisUrl}" "$skepsis_dir"
            git -C "$skepsis_dir" checkout --detach "${bootstrap.skepsisRevision}"
          elif [ -z "$(git -C "$skepsis_dir" status --porcelain)" ]; then
            current_revision="$(git -C "$skepsis_dir" rev-parse HEAD 2>/dev/null || true)"
            if [ "$current_revision" != "${bootstrap.skepsisRevision}" ]; then
              git -C "$skepsis_dir" fetch --depth 1 origin "${bootstrap.skepsisRevision}"
              git -C "$skepsis_dir" checkout --detach "${bootstrap.skepsisRevision}"
            fi
          else
            echo "warning: leaving dirty Skepsis checkout unchanged: $skepsis_dir" >&2
          fi

          if [ -f "$skepsis_dir/package.json" ] && [ ! -d "$skepsis_dir/node_modules" ]; then
            if [ -f "$skepsis_dir/pnpm-lock.yaml" ]; then
              pnpm --dir "$skepsis_dir" install --frozen-lockfile
            else
              pnpm --dir "$skepsis_dir" install
            fi
          fi

          setup_file="$HOME/.executor/setup.ts"
          if [ -x "$setup_file" ] && command -v executor >/dev/null 2>&1; then
            "$setup_file"
            executor daemon restart --base-url http://localhost:4789 >/dev/null 2>&1 || true
          fi

          echo "nixfiles bootstrap complete"
        '';
      };

      nixfilesCheck = pkgs.writeShellApplication {
        name = "nixfiles-check";
        runtimeInputs = [
          pkgs.deadnix
          pkgs.git
          pkgs.nix
          pkgs.nixfmt
        ];
        text = builtins.readFile ../scripts/check.sh;
      };
    in
    {
      imports = [ shellInteractive ];

      home.packages = [
        pkgs.fd
        pkgs.nh
        nixfilesBootstrap
        nixfilesCheck
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

      programs.zsh.completionInit = "autoload -U compinit && compinit -C";

      # secret: lazy alias completion, cached 60s; no startup cost beyond
      # registering one widget. The cache is refreshed only when TAB is used.
      programs.zsh.initContent = ''
        # took: precise sub-second command durations (starship only shows
        # whole seconds). Pass the value to the Starship prompt so it stays
        # on the same line as the working-copy metadata.
        zmodload zsh/datetime 2>/dev/null || true
        # In an indented string a doubled quote is an escape, so exactly
        # three quotes here render as an empty string. Four would leave an
        # unterminated quote that swallows the rest of this block.
        _secret_took_start='''
        _secret_preexec() {
          _secret_took_start=$EPOCHREALTIME
        }
        _secret_precmd() {
          export STARSHIP_TOOK=""
          if [[ -n "$_secret_took_start" ]]; then
            local took=$(( EPOCHREALTIME - _secret_took_start ))
            if (( took >= 0.03 )); then
              printf -v STARSHIP_TOOK 'took %.2fs' "$took"
            fi
          fi
          _secret_took_start=$EPOCHREALTIME
        }
        autoload -Uz add-zsh-hook
        add-zsh-hook preexec _secret_preexec
        add-zsh-hook precmd _secret_precmd

        # secret: unlock exports BW_SESSION into this shell; flag variants
        # and help go through the CLI (Touch ID, keychain, -h).
        source ~/.config/secret/secret-shell.zsh

        # secret completions live in a deployable, testable file.
        source ~/.config/secret/secret-completion.zsh

        # SecretBar project detection: publish only the current directory,
        # never shell variables or secret values. SecretBar uses the longest
        # matching ~/dev/*/.secret.json ancestor.
        _secretbar_context() {
          local context_dir="$HOME/.config/secretbar"
          local context_file="$context_dir/context"
          local context_tmp="$context_file.$$"
          umask 077
          mkdir -p "$context_dir"
          printf '%s\n' "$PWD" > "$context_tmp" && mv -f "$context_tmp" "$context_file"
        }
        add-zsh-hook precmd _secretbar_context
      '';

      # secret: bash twin of the zsh completion, same cache file. Registers one
      # function at startup; the cache is touched only on TAB.
      programs.bash.initExtra = lib.mkAfter ''
        # secret: unlock exports BW_SESSION into this shell; --store persists it.
        secret() {
          if [[ "$1" == "unlock" ]]; then
            local token
            token="$(env -u BW_SESSION bw unlock --raw)" || return 1
            export BW_SESSION="$token"
            if [[ "$*" == *"--store"* ]]; then
              local session_file="''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}"
              printf '%s' "$token" > "$session_file"
              chmod 600 "$session_file"
            fi
            echo "secret: unlocked for this shell"
          elif [[ "$1" == "lock" ]]; then
            unset BW_SESSION
            command secret "$@"
          else
            command secret "$@"
          fi
        }

        # secret completions live in a deployable, testable file.
        source ~/.config/secret/secret-completion.bash

        # SecretBar project detection: publish only the current directory,
        # never shell variables or secret values.
        _secretbar_context() {
          local context_dir="$HOME/.config/secretbar"
          local context_file="$context_dir/context"
          local context_tmp="$context_file.$$"
          umask 077
          mkdir -p "$context_dir"
          printf '%s\n' "$PWD" > "$context_tmp" && mv -f "$context_tmp" "$context_file"
        }
        PROMPT_COMMAND="_secretbar_context''${PROMPT_COMMAND:+;''${PROMPT_COMMAND}}"
      '';

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

      home.activation.warnMissingBootstrapTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        ${nixPathSetup}
        export PNPM_HOME="${pnpmHome}"
        export PATH="${pnpmBin}:$PATH"
        missing_tools=""
        for tool in executor pi ast-outline; do
          if ! command -v "$tool" >/dev/null 2>&1; then
            missing_tools="''${missing_tools:+$missing_tools }$tool"
          fi
        done
        if [ -n "$missing_tools" ]; then
          echo "warning: missing optional tools: $missing_tools; run nixfiles-bootstrap" >&2
        fi
      '';

      home.activation.executorSeed = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          export PATH="${pkgs.nodejs_24}/bin:${pnpmBin}:$PATH"

          setup_file="${config.home.homeDirectory}/.executor/setup.ts"
          executor_config="${config.home.homeDirectory}/.executor/executor.jsonc"
          github_token_file="${config.home.homeDirectory}/.config/opencode/github-token"
          setup_hash_file="${config.home.homeDirectory}/.executor/.setup-inputs.sha256"
          setup_hash="$(
            for input in "$setup_file" "$executor_config" "$github_token_file"; do
              if [ -f "$input" ]; then
                ${pkgs.coreutils}/bin/sha256sum "$input"
              fi
            done | ${pkgs.coreutils}/bin/sha256sum | ${pkgs.coreutils}/bin/cut -d ' ' -f1
          )"
        previous_setup_hash="$(${pkgs.coreutils}/bin/cat "$setup_hash_file" 2>/dev/null || true)"
          setup_changed=0

          if [ -x "$setup_file" ] && command -v executor >/dev/null 2>&1 && [ "$setup_hash" != "$previous_setup_hash" ]; then
            if $DRY_RUN_CMD "$setup_file"; then
              setup_changed=1
              if [ -z "$DRY_RUN_CMD" ]; then
                printf '%s\n' "$setup_hash" > "$setup_hash_file"
              fi
            else
              echo "warning: Executor seeding failed; it will be retried on the next activation" >&2
            fi
          fi

          if [ "$setup_changed" -eq 1 ] && command -v executor >/dev/null 2>&1; then
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
        enableBashIntegration = false;
        enableZshIntegration = false;
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

        cmd_duration.disabled = true;

        custom.jj = {
          format = "$output ";
          command = lib.getExe jjPromptCached;
          detect_folders = [ ".jj" ];
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

        custom.took = {
          command = "printf '%s' \"$STARSHIP_TOOK\"";
          when = "test -n \"$STARSHIP_TOOK\"";
          format = " [$output]($style)";
          style = "bold yellow";
          ignore_timeout = true;
        };

        git_branch.disabled = true;
        git_status.disabled = true;
      };

      programs.direnv = {
        enable = true;
        nix-direnv.enable = true;
        enableBashIntegration = false;
        enableZshIntegration = false;
        silent = true;
        config.global = {
          hide_env_diff = true;
          warn_timeout = "0s";
        };
      };
    };
}
