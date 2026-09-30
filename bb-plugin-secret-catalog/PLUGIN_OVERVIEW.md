# Secret Catalog

## User problem

Configured secrets already live behind the `secret` CLI, but BB sessions lack a quick, value-safe way to inspect aliases and retrieve a credential when needed.

## Behavior

- Selects a connected BB machine and lists global aliases immediately, then browses project folders on that machine.
- Filters project, global, and local alias metadata from `secret print` without loading values.
- Shows values only after a user selects Reveal, or an agent calls `secret_get`.
- Copies through `secret get --copy`, keeping the value out of the BB frontend.
- Creates aliases, renames them with `secret mv`, updates values through `secret set`, and removes configuration aliases with `secret unset`; values travel over stdin.
- Removing an alias does not delete its Bitwarden item.
- Does not duplicate storage, inspect vault internals, or write secrets to plugin storage.
