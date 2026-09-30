# Secret Catalog

## User problem

Configured secrets already live behind the `secret` CLI, but BB sessions lack a quick, value-safe way to inspect aliases and retrieve a credential when needed.

## Behavior

- Lists project, global, and local alias metadata from `secret print --all --json` on a selected BB host.
- Shows values only after a user selects Reveal, or an agent calls `secret_get`.
- Copies through `secret get --copy`, keeping the value out of the BB frontend.
- Does not duplicate storage, inspect vault internals, or write secrets to plugin storage.
