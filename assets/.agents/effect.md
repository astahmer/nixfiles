
### Effect

- MUST: Add (if missing) or read Effect as reference repository and use that for usage examples/docs for Effect APIs.
- MUST: Use `Effect.fn` and `Effect.withSpan` to wrap effectful functions.
- MUST: Use the native Effect way of doing things (with effect API or @effect/platform APIs if available); fallback to `Effect.promise` when necessary.
- MUST: Use qualified errors with Effect Schema.TaggedError.
- MUST: Avoid abstracting effects with unecessary functions; take advantage of Effect's built-in capabilities (success channel, error channel, and requirements).
- MUST: Avoid unnecessary destructuring. Use dot notation to preserve context.
- MUST: Avoid `else` statements. Prefer early returns.
