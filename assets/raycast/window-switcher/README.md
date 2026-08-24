# window-switcher (local Raycast extension)

Switch to **any window of any app on any Space** — multiple windows of the same
app (VSCode, Chrome, Ghostty, …) are listed and focusable individually,
including fullscreen windows living in their own Space.

## Why a custom extension

macOS Accessibility (`AXWindows`) only reports the windows that live on the
**currently visible Space(s)** on this setup, which is exactly why Raycast's
stock Window Management commands can't see your other VSCode windows. This
extension therefore:

1. **Lists** windows through `CGWindowListCopyWindowInfo` (sees every window on
   every Space, plus real titles when Screen Recording permission is granted).
2. **Focuses** the picked window via two paths:
   - `AXRaise` when the window is reachable through Accessibility (same Space,
     normal cross-Space windows, un-minimizing minimized ones), else
   - activates the app and clicks the matching entry in its native
     **Window menu**, which lists *all* windows across Spaces/fullscreen and
     makes macOS jump straight there. Verified to work for fullscreen
     other-Space windows where cmd-\` cycling does nothing.

The engine is a small Swift helper (`assets/winlist.swift`) compiled once by the
extension into `~/Library/Caches/dev.nixfiles.window-switcher/winlist`
(recompiles automatically whenever the source hash changes).

## Install

```bash
cd ~/dev/nixfiles/assets/raycast/window-switcher   # or ~/RaycastExtensions/window-switcher
pnpm install
```

Then in Raycast: `Import Extension` → pick this folder. Assign e.g. `⌥Space`
or any hotkey you like to the `Switch Window` command.

The folder is also symlinked to `~/RaycastExtensions/window-switcher`
by Home Manager (`modules/raycast-local-extensions.nix`), so importing from the
stable path survives moving/cloning the nixfiles repo.

## Permissions (first runs)

- **Accessibility** (Raycast) — AX raise / System Events UI scripting.
- **Screen Recording** (Raycast) — without it all window titles come back empty
  and the list shows untitled entries plus a warning banner with a shortcut to
  the right Settings pane.
- **Automation → System Events** (Raycast) — Window-menu clicking fallback.
- Xcode Command Line Tools — needed once for `swiftc`.

## Files

- `assets/winlist.swift` — helper source (`list` / `focus <pid> <cgid> <title>`).
- `src/lib/helper.ts` — compile-cache + exec plumbing.
- `src/switch-window.tsx` — the List UI.

## Regression tests

```bash
npm test          # static guards + runtime contract of `winlist list`
npm run test:live # additionally performs a real cross-Space focus round-trip
```

`tests/check.mjs` guards every bug class that actually bit us:

| Guard | Catches |
|---|---|
| source uses `kCGWindowName`, never `kCGWindowTitle` | wrong CG dictionary key (titles empty) |
| no `kCGWindowAlpha … continue` filter | other-Space windows dropped from the list |
| helper.ts verifies `ws-diag` marker in built binary | stale binary served after source changes |
| newest-mtime source selection across candidate paths | stale `environment.assetsPath` copy shadowing edits |
| repo ↔ `~/RaycastExtensions/window-switcher` diff | seeded-folder drift after nixapply |
| `winlist list` JSON contract + title coverage invariants | schema breaks, silent title loss (majority titled, other-Space rows titled) |
| live E1/E2: dead pid / bogus cgid | crashes or ungraceful errors on bad input |
| live E3: focus with EMPTY title (cgid-based paths only) | title-dependent regressions in AX/scan paths |
| live E4: off-Screen window focus round-trip + restore | the "does nothing on Enter" class of bugs |
| live E5: duplicate titles across windows | wrong-window disambiguation |
| live E6: rapid focus bursts | deadlocks/hangs; must finish < 75s |
| post-suite restore of your original frontmost window | tests leaving your session elsewhere |

`--live` focuses a real off-screen window and polls up to 8 s for the Space
switch, then restores the previous window. It mutates your session briefly —
run it when you're not mid-something.

Not automatable (by macOS design): TCC permission grants and the one-time
Accessibility/Automation consent prompts — those need a human.
