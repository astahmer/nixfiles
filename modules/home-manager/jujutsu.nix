{ config, ... }:
{
  config.flake.modules.homeManager.jujutsu =
    { pkgs, ... }:
    {
      programs.jujutsu = {
        enable = true;
        package = pkgs.jujutsu;
        settings = {
          user = {
            name = "Alexandre Stahmer";
            email = "alexandre.stahmer@gmail.com";
          };

          snapshot = {
            max-new-file-size = "12MiB";
          };

          ui = {
            editor = "code --wait";
            conflict-marker-style = "git";
            bookmark-list-sort-keys = [
              "committer-date-"
              "author-date-"
              "name"
            ];
            tag-list-sort-keys = [
              "committer-date-"
              "author-date-"
              "name"
            ];
            default-command = "log";
          };

          "revset-aliases" = {
            work = "heads(::@ ~ description(exact:''))::";
            "closest_bookmark(to)" = "heads(::to & bookmarks())";
            "closest_pushable(to)" = "heads(::to & ~description(exact:\"\") & (~empty() | merges()))";
            latest = "latest(@::)";
            "slice()" = "slice(@)";
            "slice(from)" = "ancestors(reachable(from, mutable()), 2)";
            tip = "exactly(heads(@-::~@), 1)";
            "branch_start(to)" = "heads(::to & trunk())+ & ::to";
          };

          aliases = {
            d = [ "duplicate" ];
            f = [ "git" "fetch" ];
            l = [ "log" "-r" ];
            stat = [ "log" "--stat" "-r" ];
            #
            branch = [ "bookmark" "set" "--revision" "@" ];
            tug = [
              "bookmark"
              "move"
              "--from"
              "closest_bookmark(@)"
              "--to"
              "closest_pushable(@)"
            ];
            #
            slice = [ "log" "-r" "slice()" ];
            tip = [ "log" "-r" "tip" ];
            mine = [ "log" "-r" "mine()" ];
            #
            vs = [ "log" "-r" "trunk()..closest_pushable(@)" ];
            vsb = [ "log" "-r" "trunk()..closest_bookmark(@)" ];
            #
            by = [ "log" "-n" "2" ];
            bk = [ "log" "-r" "bookmarks()" ];
            rb = [ "rebase" "-b" "@" "-o" "main@origin" ];
          };

          templates = {
            new_description = ''"wip"'';
          };

          remotes.origin = {
            auto-track-bookmarks = "*";
          }

          fix.tools.oxfmt = {
            command = [ "oxfmt" "--stdin-filepath=$path" ];
            patterns = [
              "glob:'**/*.css'"
              "glob:'**/*.html'"
              "glob:'**/*.js'"
              "glob:'**/*.json5'"
              "glob:'**/*.jsx'"
              "glob:'**/*.scss'"
              "glob:'**/*.toml'"
              "glob:'**/*.ts'"
              "glob:'**/*.tsx'"
              "glob:'**/*.vue'"
            ];
          };
        };
      };
    };
}
