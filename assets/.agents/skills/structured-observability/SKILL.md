---
name: structured-observability
description: Designs and reviews typed, correlated, bounded, and redacted logs, traces, metrics, and audit events around real work units. Use when adding observability, debugging asynchronous work, reviewing logs, or changing a service boundary.
---

# Structured Observability

Make operational evidence explain ownership and outcome without leaking
secrets or duplicating events.

## Workflow

1. Name the request, job, workflow, or other work unit being observed.
2. Define the stable event name and typed fields: correlation identifiers,
   actor or tenant context, operation, outcome, duration, and bounded error
   details.
3. Emit the primary structured event at the use-case or work-unit boundary.
   Keep adapters responsible for transport-specific metadata, not duplicate
   business events.
4. Propagate trace or correlation identifiers through async boundaries,
   retries, child work, and external calls.
5. Redact secrets and personal data, cap payload sizes, and avoid raw request
   or response bodies unless explicitly safe and necessary.
6. Ensure audit events are deliberate and emitted once. Use metrics and
   traces for aggregation and timing instead of duplicating log messages.
7. Validate the event shape, redaction, correlation, and failure paths with a
   focused test or local inspection.

## Review questions

- Can an operator identify what happened, where, for whom, and with what
  outcome?
- Can one operation be followed across retries and child work?
- Is the event useful without exposing sensitive values?
- Is ownership clear enough to avoid duplicate adapter and use-case logs?
