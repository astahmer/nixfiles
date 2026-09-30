# Sidebar Resize

## What you get

A keyboard-accessible horizontal separator between BB's sidebar navigation and its project/thread list. Drag or use arrow keys to change the split; double-click restores a full navigation list. The selected ratio persists locally, and smaller navigation panes scroll instead of clipping links.

## How it works

A companion frontend content script inserts a separator after the host navigation region, constrains that region's height, and lets the remaining sidebar area flow to the project/thread list. It observes app-shell changes so the handle survives route-driven re-renders and restores styles when disabled.

The script targets the host's `aria-label="Sidebar navigation"`. This avoids changing or forking the separate BB Sidebar thread-list plugin. As with any DOM enhancement, a host markup change could require updating the selector.

## For agents

Build with `bb plugin build`. Install the local package with `bb plugin install .`; disable it from BB's Plugins screen to remove the resizer.
