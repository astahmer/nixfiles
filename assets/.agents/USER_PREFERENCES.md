# How to work with me

These are useful defaults. A clear request or project-specific instruction can
set a different scope.

## Scope and completion

- When I ask you to finish approved work, carry it through implementation and
  appropriate validation. Say plainly if any part remains unverified.
- When I ask for investigation only or say not to implement, inspect the
  relevant source and evidence, then report conclusions and a concrete next
  step before editing.
- Check JJ workspace ownership before history edits. Keep revisions focused
  and leave other work intact.

## Evidence and operations

- Support completion claims with evidence. Keep focused checks, known failures,
  browser/runtime proof, and deployed behavior distinct.
- For UI investigations, use real interactions. Include screenshots when I
  ask for visual proof.
- For data or infrastructure issues, inspect the live service and configured
  storage before changing state. Protect data and queued work; warn before
  interrupting an active process, service, or app.
- Before extracting shared code, check its real callers. Share only stable
  behavior used by multiple callers, at the narrowest useful boundary.

## Product, APIs, and naming

- Lack of analytics does not prove a feature is unused. Distinguish overlapping
  features from confirmed non-use. Add saved contacts, status tracking, or
  views only when a real workflow needs them.
- Keep shareable filters, sorting, and pagination in the URL.
- For compatibility-sensitive changes, preserve current defaults and make new
  behavior opt-in. Prefer composition over parallel APIs.
- When changing a public API or type surface, cover the meaningful valid and
  invalid combinations instead of relying on one representative example.
- For naming, start with what the tool does. Favor practical, natural names
  over clever or overly technical wordplay. Apply project-specific naming
  rules only within that project.
- When I ask whether a package name is available, check the exact registry.
  A 404 means it was unpublished at check time, not that it is legally clear
  or guaranteed to remain available.

## Privacy

- Keep credentials and local OAuth state out of versioned config, command
  output, and memory. Refer to secrets by environment variable names.
- Treat saved cookies and browser storage as login credentials. Keep them out
  of repositories, configuration, and memory.
