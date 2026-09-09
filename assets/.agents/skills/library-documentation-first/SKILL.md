---
name: library-documentation-first
description: Verifies unfamiliar library APIs against the installed version and authoritative documentation before implementation. Use when adding or changing dependency usage, configuring a framework, or diagnosing an API/version error.
---

# Library Documentation First

Use this workflow before guessing at an unfamiliar dependency API.

## Workflow

1. Identify the package, installed version, runtime, and the nearest
   package manifest or lockfile.
2. Search the repository for existing usage and local wrappers. Prefer a
   neighboring working example over inventing a new shape.
3. Consult versioned official documentation, release notes, or the package
   source. Use the configured documentation/search connector when available.
4. Confirm the exact function, option, type, lifecycle, and error behavior
   needed by the change.
5. Implement the smallest pattern consistent with both the documentation and
   local usage.
6. Run a focused typecheck or runtime example that exercises the API.

## Report

Briefly record:

- package and version checked;
- documentation or source consulted;
- chosen API and why it fits;
- rejected or unavailable APIs;
- version-specific gotchas and the focused validation result.

Do not present a remembered API as verified. If authoritative documentation
is unavailable, state the uncertainty and prefer a narrow experiment before a
wide refactor.
