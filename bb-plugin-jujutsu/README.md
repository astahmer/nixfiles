# Jujutsu for BB

Two JJ work surfaces live in one BB sidebar page:

- **Revision graph** shows recent history, parent links, bookmarks, tags, and
  workspaces. Select a revision for its full diff, edit its description, or
  drag it onto another revision to rebase it.
- **Source Control** shows working-copy changes and the recent revision window.
  Choose how many revisions to show, select files, and split or squash changes.

## First run

Install the plugin from this directory:

```sh
bb plugin install .
```

Open **Jujutsu** from the BB sidebar. Enter a directory path as seen by the
selected BB host. The primary host ID is filled in when BB exposes one; remote
hosts can be selected by entering their host ID. The path and host ID stay in
this browser's local storage.

The selected directory must be inside a JJ workspace, and `jj` must be on that
host's `PATH`. Commands use argument arrays and run with the selected workspace
as their working directory.

## JJ operations

Description edits call `jj describe`. Drag-and-drop calls `jj rebase -r`.
Squash calls `jj squash --from REV --into DEST` and keeps the destination
description. Split uses JJ's fileset form (`jj split -r REV FILE...`) with the
description entered in the panel. All changes are immediately applied to the
workspace.

## Development

```sh
npm install
bb plugin types --check
npx tsc --noEmit
bb plugin build
```
