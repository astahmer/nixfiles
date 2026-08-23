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
