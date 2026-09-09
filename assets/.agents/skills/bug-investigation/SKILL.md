---
name: bug-investigation
description: Provides a reproduce-first workflow for isolating root causes, adding regression coverage, and validating focused bug fixes. Use when behavior is wrong, a test fails, an error is reported, or a runtime regression needs diagnosis.
---

# Bug Investigation

Do not begin with a speculative rewrite.

## Workflow

1. Write down expected behavior, actual behavior, environment, and the
   smallest known reproduction.
2. Reproduce the issue locally when possible. Preserve the failing command,
   input, logs, and relevant state without exposing secrets.
3. Search the implementation, tests, recent revisions, and boundary contracts
   to locate the smallest plausible ownership area.
4. State a falsifiable root-cause hypothesis and test it with a narrow check.
5. Fix the root cause with the smallest behavior-preserving change.
6. Add a regression test or another deterministic check for the repaired
   behavior.
7. Run focused validation first, then the repository's required broader gates.

## Report

Summarize reproduction status, root cause, changed boundary, regression
coverage, validation commands, and any unrelated baseline failure. If the
issue cannot be reproduced, say what was checked and what evidence is still
missing.
