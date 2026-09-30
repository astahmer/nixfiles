# Sidebar Resize

Adds a horizontal drag handle between BB's sidebar navigation and its project/thread list. Drag to give either section more room. The handle supports keyboard resizing with the arrow keys, `Home`/`End`, and double-click to restore the default layout.

The selected split is saved in browser local storage and scales with the sidebar height. Navigation scrolls when it is smaller than its contents.

This is a companion plugin. BB's supported frontend content-script API decorates the app shell, so the existing BB Sidebar plugin does not need to be forked or changed. The script uses the host's `Sidebar navigation` accessibility label to find its insertion point.

## Development

```sh
npm install
bb plugin build
bb plugin install .
```

The content script is full-trust frontend code, like other BB plugins. Disable **Sidebar Resize** in Plugins to remove its handle and restore the host's original navigation styles.
