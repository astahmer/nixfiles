{ config, lib, ... }:
{
  config.flake.modules.homeManager.git =
    { lib, pkgs, ... }:
    {
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
          ".direnv/"
          ".env"
          ".env.*"
          ".envrc"
          "*.local"
          "*.db"
          "*.db-shm"
          "*.db-wal"
          "*.db-journal"
          "*.sqlite"
          "*.sqlite3"
          "*.sqlite-shm"
          "*.sqlite-wal"
          "node_modules/"
          ".jj/"
          ".jj-*"
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
            name = lib.mkDefault "Alexandre Stahmer";
            email = lib.mkDefault "alexandre.stahmer@gmail.com";
          };
          core.editor = lib.mkDefault "code --wait";
          init.defaultBranch = lib.mkDefault "main";
          pull.rebase = lib.mkDefault true;
          push = {
            followTags = lib.mkDefault true;
            autoSetupRemote = lib.mkDefault true;
          };
          rebase = {
            autoStash = lib.mkDefault true;
            updateRefs = lib.mkDefault true;
          };
          rerere.enabled = lib.mkDefault true;
          diff.algorithm = lib.mkDefault "histogram";
          branch.sort = lib.mkDefault "-committerdate";
          tag.sort = lib.mkDefault "taggerdate";
          pager.diff = lib.mkDefault false;
          alias = {
            go = lib.mkDefault "checkout";
            prev = lib.mkDefault "checkout -";
            new = lib.mkDefault "checkout -b";
            delete = lib.mkDefault "branch -D";
            rename = lib.mkDefault "branch -m";
            hist = lib.mkDefault ''log --pretty=format:"%h %ad | %s%d [%an]" --graph --date=short'';
            undo = lib.mkDefault "reset HEAD~ --mixed";
            search = lib.mkDefault ''!git rev-list --all | xargs git grep -F'';
          };
        };
      };
    };
}
