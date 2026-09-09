---
name: database-investigation
description: Investigates database behavior with bounded, read-only schema, data, index, and query-plan evidence before changes. Use when diagnosing queries, migrations, constraints, performance, data shape, or production-like database behavior.
---

# Database Investigation

Start with facts from the actual target database. Treat production-like
databases and user data as read-only unless the user explicitly authorizes a
mutation.

## Workflow

1. Confirm the connection target and environment without printing credentials.
2. Inspect the relevant tables, columns, types, nullability, constraints,
   foreign keys, indexes, views, and migration history.
3. Query bounded counts and representative, redacted rows. Never dump an
   entire table or sensitive column.
4. For a performance question, inspect the query shape and an appropriate
   query plan. Check selectivity and whether the intended index is usable.
5. Map database facts to the repository's schema types, query builder,
   repository boundary, and tests.
6. State the observed facts, the likely root cause, the safest next change,
   and the focused validation that would prove it.

## Rules

- Prefer read-only metadata and bounded queries.
- Keep raw row types separate from API response types.
- Do not infer constraints or data shape from TypeScript alone.
- Do not run destructive SQL, write migrations, or alter data as part of an
  investigation unless that action was explicitly requested.
- Redact identifiers and payloads in copied output.
