# Sidebar Resize

Adds a horizontal drag handle between BB's sidebar navigation and its project/thread list. Drag to give either section more room. At 76px and below, navigation collapses into a horizontal icon row, leaving nearly all sidebar height for projects and threads. The handle supports keyboard resizing with the arrow keys, `Home`/`End`, and double-click to restore the default layout.

The selected split is saved in browser local storage and scales with the sidebar height. When expanded, navigation keeps its full content height and scrolls instead of hiding links. When collapsed, each destination remains available by its icon and tooltip.

Set **Navigation density** to **Compact** or **Comfortable** under Settings → Installed plugins → Sidebar Resize.

This is a companion plugin. It uses BB's public navigation slot and frontend content-script API, so the existing BB Sidebar plugin does not need to be forked or changed. The script uses the host's `Sidebar navigation` accessibility label to find its insertion point.

## Development

```sh
npm install
bb plugin build
bb plugin install .
```

The content script is full-trust frontend code, like other BB plugins. Disable **Sidebar Resize** in Plugins to remove its handle and restore the host's original navigation styles.
