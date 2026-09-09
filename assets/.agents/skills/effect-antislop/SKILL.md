---
name: effect-antislop
description: Applies the selectable Effect-specific anti-slop profile for Effect TypeScript projects. Use when a repository uses Effect and needs rules for program ownership, service context, layers, schemas, database effects, streams, or Effect concurrency.
---

# Effect Antislop Profile

Select this profile only for repositories that use Effect. It is intentionally
separate from the generic JavaScript and TypeScript policy.

## Rule set

- no-domain-effect-run: domain code preserves Effect programs; run them only at
  application or adapter boundaries.
- no-effect-context-reprovide: do not capture and re-provide the same Effect
  context inside a domain operation.
- no-catch-if-tagged-error: let tagged domain errors preserve their type rather
  than catching and re-wrapping them with catchIf.
- no-service-flat-map-facade: avoid static service facades that repeatedly
  flatMap the same service; expose the service operation directly. This is
  implemented in the Effect Oxlint plugin so service-name configuration stays
  semantic rather than becoming a broad syntax match.
- no-unnecessary-effect-provider-wrapper and
  no-local-effect-provide-wrapper: compose required layers once at the
  boundary instead of nesting or hiding provider wrappers.
- no-fallible-database-promise: preserve failure information when lifting
  fallible database work into Effect.
- no-untyped-readable-stream-error: give readable stream failures a typed
  error channel.
- no-sequential-effect-yield-in-loop: batch independent Effect work or state
  why sequential ordering is required.
- require-explicit-schema-declare-type-guard: Schema.declare predicates must
  explicitly narrow to the declared type.
- no-variadic-effect-schema-literal: use Schema.Literals for multiple literal
  values.

## Activation

1. Confirm the repository's Effect version and local service/layer conventions.
2. Configure path ownership for domain, adapter, test, and boundary code.
3. Add valid and invalid fixtures for each enabled rule.
4. Run the focused ast-grep or Oxlint checker before enabling errors broadly.
5. Keep project-specific service names and directories in project config, not
   in this global profile.

These rules complement the generic boundary policies: decode external data
once, keep generated schemas authoritative, and preserve typed failure
channels across asynchronous work.

## Executable implementations

- `oxlint/index.mjs` contains the Effect-specific semantic rules.
- `ast-grep/rules/` contains the Effect-specific structural rules.

The Oxlint rules accept a first options object. Configure `domainPaths`,
`implementationPaths`, `databasePaths`, or `streamPaths` with repository-local
path fragments when the defaults (`domain`, `ports`, `use-cases`, `db`,
`repositories`, and `src`) do not describe the project. The service facade rule
also accepts `serviceNames` for Context.Service identifiers that do not end in
`Database`, `Reader`, `Writer`, `Store`, `Repository`, or `Service`.

Keep this profile opt-in: load `$HOME/.agents/skills/effect-antislop/oxlint/index.mjs`
as an Oxlint `jsPlugins` entry and enable only the rules that match the
repository's Effect architecture.
