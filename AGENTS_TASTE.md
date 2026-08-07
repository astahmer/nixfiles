# Agent Taste

- Prefer Jujutsu (`jj`) over Git and split work into descriptive revisions.
- Prefer Nix-managed configuration and packages over ad hoc local setup.
- Prefer upstream release artifacts and lightweight wrappers over compiling large dependency trees.
- Keep secrets out of the repository; use placeholders, Bitwarden, and explicit runtime projections.
- Install useful CLI tools through the Nix profiles and keep the curated CLI cockpit current.
- Prefer explicit, opt-in activation for tools when always-on behavior interferes with normal workflows.
- Prefer concise communication and focused changes without speculative abstractions.
- Prefer iterative improvement passes when they are directly useful, especially for tooling and startup performance.
- When a Nix activation fails, repair the source configuration and rerun the activation before handing off.
- For repository investigations, report exact file paths and line numbers with enough context to verify each finding.
