# Settings Search

Adds a compact search field above the Settings navigation. Search covers an index of settings across tabs, including labels, help text, and option names such as Queue. Results show the setting and its category; selecting one opens that category and focuses the setting when it is available. Matching settings in the current page are highlighted as you type. Search ignores letter accents; Escape clears the query.

The field is active only on BB Settings routes. It is implemented as a cleanup-safe BB content script, so it removes its field and highlights when the Settings page closes or the plugin reloads.
