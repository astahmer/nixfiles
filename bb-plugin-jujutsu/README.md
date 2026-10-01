# Jujutsu for BB

Two JJ work surfaces live in one BB sidebar page:

- **Revision graph** lays out parent links on separate lanes, groups rows by
  day, and shows relative time, bookmarks, tags, workspace labels, and a clear
  working-copy marker. Change IDs use JJ's shortest unique prefix. Older
  versions of an evolved change are marked. Ready branches are ordered by
  commit time while preserving child-before-parent history, keeping older
  evolved lines below newer independent branches. The most recent recorded JJ
  Git push is shown above the graph. Compact rows show immutable commits as
  diamonds and empty commits as hollow circles. The graph can hide immutable
  history on demand, keeping skipped ancestry visible with dashed rails. Search
  matches descriptions, change IDs, commit IDs, bookmarks, and tags. Workspace
  rails rise into their labels. Local bookmarks can be dragged onto a revision
  to preview and confirm a move; right-click a bookmark to push or remove it.
  Differing remote bookmarks appear as name@remote. Expand a revision to edit
  its description and inspect changed files. The file list
  starts collapsed; opening it shows per-file addition and deletion counts.
  The description field grows with its text up to five lines. Day groups
  collapse. Dragging a revision onto another
  projects the moved branch into the
  graph, dims its old position, and previews the command before rebasing;
  right-click a revision for common actions.
- **Source Control** follows the working copy with expandable `@-1` through
  `@-X` ancestor groups, visible even before a file is selected. Expanding an
  ancestor shows its changed-file count before the file list; **Full diff** opens
  every file diff for that revision together. The graph uses the same count and
  full-diff controls. Source Control also provides describe, split, and squash
  actions. The ancestor window is configurable.

## First run

Install the plugin from this directory:

```sh
bb plugin install .
```

Open **Jujutsu** from BB's main sidebar or add its fixed tab to the secondary
right sidebar. The machine selector chooses the only connected host
automatically. The compact project picker suggests paths already
registered by BB and also accepts a pasted path. The folder browser follows the
Secret Catalog picker, including keyboard navigation. Suggestions follow the
chosen machine. The path and machine stay in this browser's local storage.

The selected directory must be inside a JJ workspace, and `jj` must be on that
host's `PATH`. Commands use argument arrays and run with the selected workspace
as their working directory.

## JJ operations

Description edits call `jj describe`. A confirmed branch rebase calls
`jj rebase -s REV -d DEST`, moving the selected revision and its descendants
together. Squash calls `jj squash --from REV --into DEST`
and keeps the destination description. Split uses JJ's fileset form
(`jj split -r REV FILE...`) with the description entered in the panel. These
operations apply directly to the workspace.

The graph overflow menu can clear mutable empty ancestors of the current
working copy (using the repository's `jjc` revset), and remove clean non-default
workspaces whose working-copy revisions are already ancestors of the current
revision. Workspace cleanup previews candidates and asks before forgetting the
workspace and deleting its sibling directory; JJ status checks can record
working-copy snapshots. The menu can also open a prefilled thread that follows
the `jj` skill to unify recent relevant branches.

## Development

```sh
npm install
bb plugin types --check
npx tsc --noEmit
bb plugin build
```
