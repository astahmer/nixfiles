# Jujutsu for BB

Two JJ work surfaces live in one BB sidebar page:

- **Revision graph** lays out parent links on separate lanes, groups rows by
  day, and shows relative time, bookmarks, tags, workspace labels, and a clear
  working-copy marker. Change IDs use JJ's shortest unique prefix. Older
  versions of an evolved change are marked, and the most recent recorded JJ
  Git push is shown above the graph. Filter by description, then expand a
  revision to edit its description and inspect changed files. Day groups
  collapse. Dragging a revision onto another projects the moved branch into the
  graph, dims its old position, and previews the command before rebasing;
  right-click a revision for common actions.
- **Source Control** follows the working copy with expandable `@-1` through
  `@-X` ancestor groups. It provides describe, split, and squash actions, and
  opens BB's native diff viewer only after selecting a file. The ancestor
  window is configurable.

## First run

Install the plugin from this directory:

```sh
bb plugin install .
```

Open **Jujutsu** from BB's main sidebar or add its fixed tab to the secondary
right sidebar. The machine selector chooses the only connected host
automatically. The editable project-path combobox suggests paths already
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

## Development

```sh
npm install
bb plugin types --check
npx tsc --noEmit
bb plugin build
```
