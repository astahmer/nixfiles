{ config, ... }:
{
  config.flake.modules.homeManager.shell =
    { config, lib, pkgs, ... }:
    let
      jjPackage =
        if config.programs.jujutsu.package != null then config.programs.jujutsu.package else pkgs.jujutsu;
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
        eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
        eval "$(${lib.getExe jjPackage} util completion bash)"
      '';

      programs.zsh.initContent = lib.mkAfter ''
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
        eval "$(${lib.getExe jjPackage} util completion zsh)"
      '';

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
        pnpmi = "pnpm i";
        copilot = "gh copilot suggest -t shell";
        nts = "node --no-warnings=ExperimentalWarning --experimental-strip-types --experimental-transform-types --env-file-if-exists=.env";
      };
    };
}
