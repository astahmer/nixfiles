# Diff Viewed

Keep your place in a long diff. Every file in bb's changes panel gets a
**Viewed** checkbox: check it and the file collapses, its header dims, and it
stays that way until the file's diff changes.

You can also enable **Mark files viewed when scrolling past them** in the
plugin's settings. As you scroll down, each file is checked and collapsed when
its header passes above the changes panel's scroll area. This option is off by
default, so manual marking works as before until you turn it on.

![Three files marked viewed and collapsed above a file still expanded](docs/viewed.png)

## Use

- Open the changes panel (⌘ D). Each file header now ends with a **Viewed**
  checkbox beside its `+N -M` counts.
- Check a file to fold it away. What is still expanded is what you have not
  read yet.
- Uncheck it to bring it back. Nothing else about the panel changes.
- The toolbar shows how far you have got, as "3/8 viewed" with a progress
  ring, right-aligned above bb's line counts in place of bb's file count. It
  counts every file in the selected range, including the ones you have not
  scrolled to yet, and a file only counts while its mark matches its current
  diff.
- To hide viewed files entirely, open the range dropdown at the top of the
  panel ("All changes", "Uncommitted changes") and pick **Only unviewed** at
  the bottom. Pick it again to show every file. The choice applies to every
  thread and is remembered across restarts.

The Only unviewed item is not in bb's keyboard navigation for that menu, so it
takes a click. On a narrow window, where bb shows the menu as a sheet, the item
is not offered.

Marks are kept per thread and survive a reload and a restart of bb. Another
open window picks up a change when it regains focus.

## What clears a mark

A mark is keyed on the thread, the file path, and the file's `+N -M` counts.
Because the counts are part of the key, the mark clears itself when the file's
diff changes: rebase the branch, add a hunk, or revert the file, and it comes
back expanded and undimmed. An edit that adds and removes the same number of
lines keeps the mark, since the counts carry no other per-file signal.

Marks for files that leave the diff are pruned the next time the panel shows
All changes.

## Install

Install this fork from its local path so BB uses the version with the automatic
scroll setting:

```sh
bb plugin install ~/dev/nixfiles/bb-plugin-diff-viewed --yes
```

Needs bb 0.41 or later. No account, external service, or separate install.

## Development

Build it with bb after making changes:

```sh
cd ~/dev/nixfiles/bb-plugin-diff-viewed
bb plugin build .
```

The scroll option is available in Settings → Installed plugins → Diff Viewed.

## Related plugins

- **Guided Review** (`guided-review`) also tracks viewed files, inside its own
  reading guide for a GitHub pull request or a local Git range. Diff Viewed
  puts the mark on bb's own changes panel for the thread you are in, needs no
  GitHub sign-in or agent provider, and clears a mark when that file's diff
  changes.

## How it works

bb owns the diff card header. `experimental_diffRenderer` replaces a diff's
*body*, and the header's `statSlot` / `actionSlot` are internal, so the checkbox
cannot come from a normal plugin slot. It comes from a content script instead,
which is what the SDK sanctions for decorating existing app-shell DOM.

The script anchors only on things bb emits deliberately:

| Anchor | Used for |
| --- | --- |
| `[data-timeline-file-diff]` | Skipping timeline diffs |
| `aria-label="Collapse <path>"` | Reading each card's file path |
| `aria-expanded` | Reading and driving collapse |
| `[data-testid="git-diff-toolbar-actions"]` | Knowing the changes panel is open |
| `[data-testid="git-diff-toolbar-selector-slot"]` and the trigger's `aria-controls` | Finding the open range dropdown to add Only unviewed |
| `[data-index]` | The virtualized row to hide while Only unviewed is on, and where the file list is read from |
| `[data-testid="git-diff-toolbar-details"]` | Stacking the progress line above bb's line counts and hiding its file count |

No minified class names. If bb changes the header and the anchors stop
matching, the plugin decorates nothing and bb behaves exactly as it does
without it. The one exception is the full file list, described below.

Marks live in the plugin's kv storage, which is what makes them survive a
reload. Another window picks them up on focus rather than live, because
realtime subscription is a React-side API and a content script has no component
to hang it on.

There is deliberately no "card must be inside container X" check. bb's file
card list carries no attribute of its own, and `data-secondary-panel-tab-content`
— which reads like the right one — is the *tab strip's* inner container, not a
tab's content. Requiring it matched nothing on any screen. The structural checks
in `resolveCard` carry that weight instead: the collapse button must be the
first child of the header's left span, and the header row must have exactly two
children and `justify-between`.

### The full file list

bb draws only the file cards near the scroll position, so the DOM never holds
the whole diff. The progress count and the pruning of old marks both need it,
so they read the `files` prop of bb's `DiffFilesPanel` from the React fiber on
a rendered row, along with `target`, the selected range. This is the one
anchor bb does not emit on purpose, which is why it is checked rather than
trusted: every entry must have the fields the plugin reads, or the read fails
with a reason.

A failed read is not silent. The toolbar shows **Viewed progress
unavailable**, with the reason in its tooltip, and the reason goes to the
plugin's server log once per window:

```sh
bb plugin logs diff-viewed
```

The Viewed checkboxes keep working, and pruning stops, since pruning against
a partial list would delete marks that are still good. Pruning also runs only
on the All changes range, because a narrower range leaves out files whose
marks still apply. To fix a failed read after a bb upgrade, read
`DiffFilesPanel.tsx` in bb's `apps/app/src/components/secondary-panel/git-diff`
and update `viewed/files.ts`.

A mark's fingerprint is `+a -b`. The card header leaves out a zero count on an
added or deleted file and writes thousands with commas, so the header's text
is normalized to match what the file list gives.

### Only unviewed

Only unviewed hides rows with CSS: an attribute on `<html>` turns on a rule
that sets `display: none` on any row containing a header marked viewed. bb's
file list is virtualized, and the virtualizer measures each row with a
`ResizeObserver`, so a hidden row measures as zero height and the rows after it
move up. Nothing else in bb's state changes, which is why the file count in the
toolbar still counts every file.

## Layout

| Path | Holds |
| --- | --- |
| `viewed/marks.ts` | Pure logic: keying, fingerprinting, record changes |
| `viewed/dom.ts` | Reading and decorating bb's card headers, toolbar, and range dropdown |
| `viewed/files.ts` | Reading the panel's full file list from React props |
| `viewed/engine.ts` | The sync loop: passes, observers, click handling, cleanup |
| `server.ts` | RPC contract and kv storage for marks and the filter |
| `app.tsx` | Wiring only: real fetch, real scheduler, real document |

## Development

```sh
npm install
npm test
npm run typecheck
bb plugin build && bb plugin reload diff-viewed
```

`viewed/engine.test.ts` drives the whole loop against a DOM shaped like bb's,
with a stand-in for React that flips `aria-expanded` on click. The engine is
split out of `app.tsx` precisely so it can be tested: every bug this plugin has
shipped lived in that loop and survived a green run, because only the pure
functions had tests.

`viewed/dom.test.ts` holds a fixture of the card header DOM as bb renders it.
After a bb upgrade, those are the tests that fail first; re-read
`GitDiffCardHeader-*.js` in bb's `app/dist/assets` and update the fixture and
`viewed/dom.ts` together.

The RPC surface against a running server:

```sh
BASE=$(node -p "require(process.env.HOME+'/.bb/bb-app-runtime.json').serverUrl")
curl -s -X POST -H "content-type: application/json" -H "origin: $BASE" \
  -d '{"threadId":"thr_x"}' "$BASE/api/v1/plugins/diff-viewed/rpc/viewed_list"
```
