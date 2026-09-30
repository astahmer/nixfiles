# Sidebar Resize

## What you get

A keyboard-accessible horizontal separator between BB's sidebar navigation and its project/thread list. Drag or use arrow keys to change the split; double-click restores the default navigation height. At 76px and below, navigation becomes a horizontal icon row so the project/thread list can take almost all available height. The selected ratio persists locally. Settings control expanded navigation density and choose scrolling, overflow menu, or both when collapsed; the default keeps a fixed menu button after the scrollable icons.

## How it works

A companion frontend content script inserts a separator after the host navigation region, constrains that region's height, and lets the remaining sidebar area flow to the project/thread list. A supported BB navigation slot renders host destinations and actions as full rows or as a horizontal icon row when collapsed. It uses the host navigation hook and icon renderer, so host-owned routes and plugin branding remain intact.

The resizer targets the host's `aria-label="Sidebar navigation"`; it does not replace the BB Sidebar thread-list plugin. The navigation replacement uses BB's public Plugin SDK slot. No fork is needed.

## For agents

Build with `bb plugin build`. Install the local package with `bb plugin install .`; disable it from BB's Plugins screen to remove the resizer.
