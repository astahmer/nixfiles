{ ... }:
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

          git = {
            write-change-id-header = true;
          };

          ui = {
            editor = "fresh";
            conflict-marker-style = "git";
            pager = "delta";
            # https://docs.jj-vcs.dev/latest/config/#processing-contents-to-be-paged
            diff-formatter = ":git";
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
            "closest_bookmark(to)" = "heads(::to & bookmarks())";
            "closest_pushable(to)" = "heads(::to & ~description(exact:\"\") & (~empty() | merges()))";
            latest = "latest(@::)";
            "slice()" = "slice(@)";
            "slice(from)" = "ancestors(reachable(from, mutable()), 2)";
            tip = "exactly(heads(@-::~@), 1)";
            "branch_start(to)" = "heads(::to & trunk())+ & ::to";
            "changes(from, to)" = "from..to";
          };

          aliases = {
            d = [ "duplicate" ];
            f = [
              "git"
              "fetch"
            ];
            # `jj l` shows commits on the working-copy commit's (anonymous) bookmark
            # compared to the `main` bookmark
            # l = ["log", "-r", "(main..@):: | (main..@)-"]
            l = [
              "log"
              "-r"
              "(trunk()..closest_bookmark(@)):: | (trunk()..closest_bookmark(@))-"
            ];
            push = [
              "git"
              "push"
            ];
            stat = [
              "log"
              "--stat"
              "-r"
            ];
            # Current commit (@ vs parents) — one line, no paths; e.g. 483 files changed, +7723 -2685
            shortstat = [
              "log"
              "-r"
              "@"
              "--no-graph"
              "--no-pager"
              "-T"
              ''self.diff().files().len() ++ " files changed, +" ++ self.diff().stat().total_added() ++ " -" ++ self.diff().stat().total_removed()''
            ];
            # Between two revsets (e.g. main → @): jj diff --git --from main --to @ --no-pager | diffstat -s
            #
            branch = [
              "bookmark"
              "set"
              "--revision"
              "@"
            ];
            tug = [
              "bookmark"
              "move"
              "--from"
              "closest_bookmark(@)"
              "--to"
              "closest_pushable(@)"
            ];
            #
            slice = [
              "log"
              "-r"
              "slice()"
            ];
            tip = [
              "log"
              "-r"
              "tip"
            ];
            mine = [
              "log"
              "-r"
              "mine()"
            ];
            #
            vs = [
              "log"
              "-r"
              "trunk()..closest_pushable(@)"
            ];
            vsb = [
              "log"
              "-r"
              "trunk()..closest_bookmark(@)"
            ];
            #
            by = [
              "log"
              "-n"
              "2"
            ];
            bk = [
              "log"
              "-r"
              "bookmarks()"
            ];
            rb = [
              "rebase"
              "-b"
              "@"
              "-o"
              "main@origin"
            ];
            rl = [
              "resolve"
              "-l"
            ];

            # https://pksunkara.com/tech-notes/jujutsu-keeping-a-file-untracked/
            ignore = [
              "util"
              "exec"
              "--"
              "bash"
              "-c"
              "jj"
              "config"
              "set"
              "--repo"
              "snapshot.auto-track"
              "$(jj"
              "config"
              "get"
              "snapshot.auto-track"
              ")"
              "&"
              "~"
              "$0"
              "&&"
              "jj"
              "file"
              "untrack"
              "$0"
            ];
            # https://pksunkara.com/tech-notes/jujutsu-managing-workspaces/
            wo = [
              "util"
              "exec"
              "--"
              "bash"
              "-c"
              "jj"
              "workspace"
              "root"
              "--name"
              "$(jj"
              "workspace"
              "list"
              "|"
              "fzf"
              "|"
              "cut"
              "-d:"
              "-f1"
              ")"
            ];
            wa = [
              "util"
              "exec"
              "--"
              "bash"
              "-c"
              "jj"
              "workspace"
              "add"
              "--name"
              "$0"
              "$(jj"
              "workspace"
              "root"
              "--name"
              "default"
              ").$0"
            ];
          };

          templates = {
            new_description = ''"wip"'';
          };

          remotes.origin = {
            auto-track-bookmarks = "*";
          };

          fix.tools.oxfmt = {
            command = [
              "oxfmt"
              "--stdin-filepath=$path"
            ];
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
