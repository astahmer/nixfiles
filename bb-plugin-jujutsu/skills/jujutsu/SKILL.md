---
name: jujutsu
description: Browse and change Jujutsu workspaces from the BB Jujutsu plugin.
---

# Jujutsu plugin

Use the Jujutsu sidebar page to inspect revision history and working-copy
changes. The graph exposes bookmarks, tags, and workspaces, supports description
edits and drag-and-drop rebases, and shows full revision diffs. Source Control
supports file selection for `jj split`, `jj squash`, and a configurable recent
revision window.

Mutating controls execute JJ commands immediately in the selected workspace.
Splitting uses JJ's configured diff editor. Keep the host ID and repository
path scoped to the repository the user intends to change.
