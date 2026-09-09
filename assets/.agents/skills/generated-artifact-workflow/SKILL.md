---
name: generated-artifact-workflow
description: Safely changes schemas, migrations, generated clients, snapshots, fixtures, and other derived artifacts through their source of truth. Use when code generation, migrations, OpenAPI, schemas, snapshots, or checked-in generated output is involved.
---

# Generated Artifact Workflow

Treat generated output as a contract, not a convenient file to patch.

## Workflow

1. Identify the source of truth, generator, exact command, output paths, and
   whether the artifact is committed.
2. Read the relevant configuration and neighboring generated files before
   changing anything.
3. Change the schema, source, template, or generator input—not the generated
   result.
4. Run the repository-pinned generation command.
5. Inspect the complete diff for stale output, accidental broad churn,
   missing files, and source/consumer incompatibilities.
6. Run focused validation for acceptance and rejection behavior. For clients
   or adapters, validate every supported runtime or transport that the
   project claims to support.
7. Record generated paths, command, dependencies, and any known gaps.

## Rules

- Never hand-edit generated code or migrations to hide a source-of-truth
  problem.
- Treat generated snapshots and fixtures as behavioral contracts.
- Keep generated changes isolated from unrelated refactors.
- If regeneration is unavailable, stop before editing output and report the
  missing generator or pinned toolchain.
