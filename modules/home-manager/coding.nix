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
        curl
        uv
        qdirstat
        htop
        devenv
        docker-compose
      ];

      programs.bash.enable = true;
      programs.bash.shellAliases = {
        nixos-switch = "sudo nixos-rebuild switch --flake ${config.home.homeDirectory}/dev/alex/nixfiles#${config.flake.nixosHostName}";
      };
      programs.bash.initExtra = ''
        eval "$(${pkgs.lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
      '';

      programs.git = {
        enable = true;
        package = pkgs.git;
        lfs.enable = true;
        ignores = [
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
        settings = {
          user = {
            name = "Alexandre Stahmer";
            email = "alexandre.stahmer@gmail.com";
          };
          core = {
            editor = "code --wait";
            excludesFile = "${config.home.homeDirectory}/.config/git/ignore";
          };
          init.defaultBranch = "main";
          pull.rebase = true;
          push = {
            followTags = true;
            autoSetupRemote = true;
          };
          rebase = {
            autoStash = true;
            updateRefs = true;
          };
          rerere.enabled = true;
          diff.algorithm = "histogram";
          branch.sort = "-committerdate";
          tag.sort = "taggerdate";
          pager.diff = false;
          alias = {
            go = "checkout";
            prev = "checkout -";
            new = "checkout -b";
            delete = "branch -D";
            rename = "branch -m";
            hist = ''log --pretty=format:"%h %ad | %s%d [%an]" --graph --date=short'';
            undo = "reset HEAD~ --mixed";
            search = ''!git rev-list --all | xargs git grep -F'';
          };
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
