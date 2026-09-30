Bring Jujutsu's revision graph and working-copy workflow into BB. Browse
revision history with bookmarks, tags, and workspace labels; inspect multi-file
diffs; edit descriptions; and preview and confirm branch rebases by dragging
revisions in the graph. The graph supports description filtering, day collapse,
relative timestamps, JJ-style shortest unique change IDs, evolved revision
markers, and the last recorded JJ Git push. A projected rebase branch appears
in place with the original revisions dimmed before confirmation. Revision
context menus provide common actions. A
second view focuses on changed files, splitting selected files into a new
revision, squashing revisions, and a configurable recent-history window.

The plugin runs JJ on a selected BB host, in a repository path you provide.
Revision mutations happen in that workspace; split descriptions are entered
in the panel.
