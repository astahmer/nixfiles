---
name: security-review
description: Reviews code and changes for authorization, validation, injection, secret exposure, sensitive-data leakage, dangerous execution, and dependency risks. Use when reviewing a diff, adding an endpoint or integration, handling user or tenant data, or changing authentication and permissions.
---

# Security Review

Review the actual data and trust boundaries, not just names that look secure.

## Checklist

- Authentication, authorization, tenant or organization isolation, and
  default-deny behavior;
- validation and normalization at every external boundary;
- SQL, shell, template, path, URL, deserialization, and prompt injection;
- secrets or personal data in source, logs, errors, responses, fixtures,
  screenshots, and generated artifacts;
- unsafe process execution, file access, redirects, uploads, and network
  calls;
- dependency provenance, version changes, and typosquat or supply-chain risk;
- tests for rejection, permission boundaries, redaction, and failure paths.

## Workflow

1. Identify actors, assets, trust boundaries, and the sensitive operation.
2. Inspect the pending diff and its callers, adapters, schemas, and tests.
3. Verify the highest-risk paths with focused tests or a safe local probe.
4. Report findings as Critical, Warning, or Note with file and line
   references, impact, and a concrete remediation.

Never print or request secret values during review. Distinguish a confirmed
vulnerability from a risk that still needs runtime or deployment evidence.
