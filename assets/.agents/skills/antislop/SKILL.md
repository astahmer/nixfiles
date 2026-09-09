---
name: antislop
description: Anti-pattern guidance and a portable baseline catalog for turning repeatable code-quality fixes into one deterministic Oxlint or ast-grep check. Use when reviewing or fixing recurring TypeScript or JavaScript anti-patterns, type assertions, reflective calls, broad boundaries, or test mocking.
---

# Antislop

When fixing or refactoring a clear anti-pattern—a needless abstraction, verbose
idiom, footgun API usage, or other form of code slop—capture the rule in plain
language before moving on:

- What should be avoided?
- What is the preferred alternative?
- Why does the distinction matter?

## Make repeatable rules deterministic

Try to turn repeatable anti-slop guidance into an executable check. Choose one
canonical implementation based on the shape of the rule:

- Use an Oxlint custom plugin or rule when the check benefits from lint
  integration, semantic context, or a project-specific TypeScript/JavaScript
  rule.
- Use an ast-grep rule when matching the syntax tree is sufficient and a small,
  structural rule is the better fit.

There is no value in implementing the same rule in both Oxlint and ast-grep.
Pick the checker that expresses the rule most directly, add a focused fixture
or test, and document the preferred alternative alongside the check.

If a rule cannot be checked reliably, keep it as concise guidance rather than
adding a brittle or noisy detector.

## Portable catalog

Start from the generic rule catalog in REFERENCE.md. Enable rules in groups
that match the repository's contracts, then add fixtures before making them
errors. Module mocking is intentionally opt-in because some test harnesses
require it. Effect-specific rules live in the separately selectable
effect-antislop skill.

## Workflow

1. Identify the anti-pattern and write the avoid/prefer/reason statement.
2. Search for an existing Oxlint or ast-grep rule before adding another one.
3. If the pattern is deterministic, choose exactly one checker and implement
   the rule there.
4. Add a focused passing and failing example where the checker supports them.
5. Run the focused checker and the relevant project validation.
6. Keep the rule close to the tool configuration and explain any intentional
   exceptions.

The baseline rules use Oxlint when enabled because scope, alias resolution,
global identity, and safety comments are semantic concerns. Do not copy the
same checks into ast-grep just to have two implementations.

## For agents

When you fix or refactor code containing a clear anti-pattern:

1. Preserve the intended behavior while removing the slop.
2. State the durable rule as “avoid X; prefer Y because Z.”
3. Try to enforce it with one Oxlint custom plugin/rule or one ast-grep rule.
4. Do not duplicate the same rule across both systems.
5. If deterministic enforcement would be noisy or fragile, leave concise
   guidance and say why a checker was not added.
