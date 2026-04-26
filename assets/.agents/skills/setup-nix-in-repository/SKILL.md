---
name: setup-nix-in-repository
description: It bootstraps repository flakes and direnv shells. Use when setting up Nix in a new repo, creating or fixing flake.nix and .envrc, or adding repo toolchains like fnm, nodejs, Playwright, and other third-party dependencies.
---

# Bootstrap Nix Repo

## Quick Start

1. Inspect the repo for existing Nix files, direnv files, package manifests, lockfiles, CI, and README notes.
2. Decide whether to extend an existing flake or create the smallest new flake that fits the repo.
3. Create or update `flake.nix`, `flake.lock`, `.envrc`, and `.gitignore` as needed.
4. Put every required runtime, build tool, and test tool in `devShells.default` so the shell is ready on `cd`.
5. Validate with `nix develop`, `direnv allow`, and the narrowest smoke test the repo has.

## Workflow

- Prefer Nix packages over bootstrap scripts or global installs.
- Keep the shell minimal, but complete enough that the repo works without extra manual setup.
- Translate requirements from `package.json`, lockfiles, `Makefile`, CI, docs, and failing commands into shell packages.
- Add repo-specific env vars and hooks in the flake shell so direnv applies them automatically.
- If the repo already uses a version manager or language toolchain file, preserve that contract instead of replacing it.

## Common Mappings

- Node repos: add the matching `pkgs.nodejs_*` for the declared engine. Keep `pkgs.fnm` only when the repo already expects fnm or a Node version manager.
- Playwright repos: add the current nixpkgs Playwright package and keep browser/runtime dependencies in the shell instead of relying on npm downloads.
- Mixed repos: include any native libraries, CLIs, code generators, formatters, and test runners that CI or local dev needs.

Example shell:

```nix
packages = [
  pkgs.fnm
  pkgs.nodejs_22
  pkgs.playwright
];
```

## Flake Shape

- Use the simplest flake that works.
- Prefer a plain `devShells.default` for small repos; use `flake-parts` or `flake-utils` only when the repo needs multi-system outputs or shared structure.
- Reuse existing inputs when the repo already has a flake.
- Add `.envrc` with `use flake` so entering the repo loads the shell automatically.
- Add `.direnv/` to `.gitignore` if it is not already ignored.

## Validation

- Confirm `nix develop` opens with the expected binaries on the host platform.
- Confirm `direnv` loads cleanly from a fresh shell session.
- If the repo has tests, run the smallest smoke test that proves the shell is usable.
