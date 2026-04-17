{
  config,
  ...
}:
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        google-chrome
        gh
        jq
        neovim
        nixd
        nixfmt
        ripgrep
        tmux
        vscode
        fnm
        jujutsu
        neovim
        curl
        ripgrep
        uv
        qdirstat
        htop
        devenv
        docker-compose
      ];

      # ------------------------------------------------------------------------
      # Shell Configuration
      # ------------------------------------------------------------------------
      programs.bash.enable = true;
      programs.bash.shellAliases = {
        nixos-switch = "sudo nixos-rebuild switch --flake ${config.home.homeDirectory}/.nixfiles#pc-fixe";
      };
      programs.bash.initExtra = ''
        eval "$(${pkgs.lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
      '';

      # ------------------------------------------------------------------------
      # Git Configuration
      # ------------------------------------------------------------------------
      # `lib.generators.toGitINI` cannot express both `[color] branch = auto` and `[color "branch"]`
      # in one attrset, so the three `[color "..."]` blocks live in `includes` (raw snippet).
      programs.git = {
        enable = true;
        package = pkgs.git;
        ignores = [
          ".vscode/tasks.json"
          ".DS_Store"
          ".DS_Store?"
          "._*"
          ".Spotlight-V100"
          ".Trashes"
          "ehthumbs.db"
          "Thumbs.db"
          "*~"
          "*.swp"
          "*.swo"
          ".#*"
          "\\#*#"
          "*.tmp"
          "*.temp"
        ];
        includes = [
          {
            path = pkgs.writeText "git-color-subsections.ini" ''
              [color "branch"]
              	current = yellow reverse
              	local = yellow
              	remote = green

              [color "diff"]
              	meta = yellow bold
              	frag = magenta bold
              	old = red bold
              	new = green bold

              [color "status"]
              	added = yellow
              	changed = green
              	untracked = cyan
            '';
          }
        ];
        settings = {
          user = {
            name = "Vincent-HD";
            email = "vincenthoudan@gmail.com";
          };
          core = {
            editor = "code --wait";
            autocrlf = "input";
            quotepath = false;
            pager = "less -FRX";
            excludesFile = "${config.home.homeDirectory}/.config/git/ignore";
          };
          init.defaultBranch = "main";
          pull.rebase = true;
          push = {
            default = "simple";
            followTags = true;
          };
          merge = {
            conflictstyle = "diff3";
            tool = "code";
          };
          mergetool = {
            code = {
              cmd = "code --wait $MERGED";
            };
          };
          diff = {
            tool = "code";
            algorithm = "histogram";
            renames = "copies";
          };
          difftool = {
            code = {
              cmd = "code --wait --diff $LOCAL $REMOTE";
            };
          };
          rebase = {
            autoStash = true;
            autoSquash = true;
          };
          fetch.prune = true;
          branch = {
            autoSetupMerge = "always";
            autoSetupRebase = "always";
          };
          color = {
            ui = "auto";
            branch = "auto";
            diff = "auto";
            status = "auto";
          };
          alias = {
            st = "status";
            co = "checkout";
            br = "branch";
            ci = "commit";
            unstage = "reset HEAD --";
            last = "log -1 HEAD";
            lg = "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit";
            ll = "log --oneline --graph --decorate --all";
            amend = "commit --amend --no-edit";
            fix = "commit --fixup";
            squash = "commit --squash";
            wip = "commit -am \"WIP\"";
            undo = "reset HEAD~1 --mixed";
            stash-show = "stash show -p";
            find = "!git log --pretty=\"format:%Cgreen%H %Cblue%s\" --name-status --grep";
            filelog = "log -u";
            aliases = "config --get-regexp alias";
          };
          help.autocorrect = 1;
          rerere.enabled = true;
          log.date = "relative";
          grep.lineNumber = true;
          tag.sort = "version:refname";
          versionsort.suffix = [
            "-pre"
            ".pre"
            "-beta"
            ".beta"
            "-rc"
            ".rc"
          ];
        };
      };

      programs.direnv = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        nix-direnv.enable = true;
      };
    };
}
