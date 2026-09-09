---
name: compact-test-evidence
description: Runs focused tests and returns compact, failure-first evidence while preserving complete diagnostics separately. Use when test output is noisy, a single regression needs debugging, or an agent must report validation without flooding the conversation.
---

# Compact Test Evidence

Optimize the agent-visible output, not the diagnostic information.

## Workflow

1. Choose the narrowest test file, test name, package, or command that proves
   the current behavior.
2. Run it from the correct package root with the repository's pinned runner.
3. Preserve complete stdout, stderr, exit status, and relevant artifacts in a
   file or test-report directory.
4. Show the agent only the failure summary, first useful stack frames, failed
   assertions, and a short pass summary.
5. If the result is not actionable, reopen the full artifact selectively.
6. Remove temporary isolation such as only markers before final validation.

## Report

Always include the exact focused command and exit status. Separate new
failures, expected failures, and pre-existing baseline failures. Never hide a
non-zero exit code behind a successful summary, and never truncate away the
diagnostic artifact needed to reproduce the result.
