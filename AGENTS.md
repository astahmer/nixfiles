# nixfiles — Agent Guidelines

This repository is a Nix flake for a single user with two entry points:

- a NixOS host in `hosts/workstation`
- a standalone macOS Home Manager profile in `hosts/macbook`

The repo uses `flake-parts` plus `import-tree`, so `.nix` files under `modules/` and `hosts/` are discovered automatically.

## Quick Start

User-facing setup, layout, and update docs live in `README.md`; clone,
symlink, and first-apply steps are described there. Day-to-day commands are
summarized under Apply Commands below.

To add a module, create a file under `modules/`, export it as `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, and wire it into `hosts/macbook/default.nix` or `hosts/workstation/default.nix`. If the concern spans both scopes, keep both outputs in the same file.

## Layout

- `inputs.agents` supplies reusable skills and an optional project `AGENTS.md` baseline. `assets/.agents/` remains the Nix-local global contract and overlay for machine-specific skills, hooks, instructions, and memory. Home Manager combines the skill trees into the deployed `~/.agents` tree.
- `inputs.emilint` owns the executable Oxlint and ast-grep rule sources and fixtures that the agents module overlays into `antislop/` and `effect-antislop/`. `modules/coding.nix` installs the matching `oxlint` and `ast-grep` CLIs globally.
- Agent deployment source is the pinned `agents` input plus `assets/.agents/` overlays and `assets/.cursor/`. Home Manager deploys to `~/.agents`, `~/.codex/AGENTS.md`, `~/.cursor/rules`, and `~/.cursor/hooks*`. Do not manually copy into `$HOME`; run `nixapply` to apply. `initagent` copies the deployed global `AGENTS.md`, not the clone.
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. Agents connect only to Executor over MCP; Executor itself hosts the GitHub Copilot, Context7, and Chrome DevTools integrations. `assets/executor/setup.ts` seeds these integrations idempotently after `nixbootstrap` and when activation inputs change.
- `readbro` is superseded by `ast-outline`. Its source remains in `assets/readbro/` for reference but is no longer deployed — neither as an MCP server nor as an agent skill. The readbro skill (`assets/.agents/skills/readbro/`) is excluded from Home Manager deployment via a source filter.
- `~/.references/` contains globally-shared cloned reference repositories used for comparison and pattern mining. Per-project `.references/` is used only as an escape hatch.

Global Codex instruction discovery uses CODEX_HOME/AGENTS.md (normally
~/.codex/AGENTS.md), while user skills use ~/.agents/skills. The agents Home
Manager module deploys both from the same machine-agnostic source tree; do not
point other projects at the clone's absolute path.

## Critical binary-first build policy

- **Very important: always try to download a compatible prebuilt binary or use a trusted binary cache before compiling from source.** This applies to Nix packages, CLI tools, and their dependencies. Check official release archives, upstream caches, and the repository's existing package pattern first. Source builds are the last resort: use them only when no compatible artifact exists or the user explicitly asks for a source build. Never start a large compilation silently; report the missing artifact or cache when it blocks the task because builds are slow and consume substantial disk space for little routine-tooling benefit.

## Reference Repos

- Reference repos are cloned to `~/.references/<name>` by default (shared globally). Use `add-reference-repository` to clone one and `read-reference-repository` to inspect it.
- To keep a clone local to a project (escape hatch), explicitly ask to "add locally" — it goes into `<project>/.references/<name>`.
- Each project tracks its references in `reference-repos.md` at the project root.
- Read the clone's `AGENTS.md` before inspecting implementation details.
- Keep reference repos read-only unless the user asks to update them.

## Nix Conventions

- Never use `with` expressions. Always prefer explicit attribute references (for example: `pkgs.spotify`, `pkgs.git`, or `pkgs."name-with-hyphen"`) or fully-qualified attribute paths. This rule applies everywhere in modules, package lists, and functions — not just to `pkgs`.
- Keep NixOS and Home Manager concerns split when the repo already has separate modules.
- Use thin host/profile files that only wire modules together.

## Data and type boundaries

- Decode external data once at the boundary; internal APIs use named validated
  types.
- Avoid chained assertions, broad object or unknown contracts, and raw
  response JSON assertions.
- Do not spread database rows or caller-controlled transport data into output
  objects; enumerate the fields that cross the boundary.
- Keep generated schemas, clients, and migrations as the source of truth.

## Apply Commands

Stable flake pointer: `~/.config/nixfiles` → clone (`NH_FLAKE`). Create with `nixfiles-here` from the clone root.

- `nh home switch -c macbook -b hm-backup` (alias: `nixapply`)
- `nh home switch -c macbook -b hm-backup -u` (alias: `nixupdate`)
- `nixfiles-bootstrap` (alias: `nixbootstrap`) installs optional external tools and seeds Executor/Skepsis.
- `nixfiles-check` (alias: `nixcheck`) runs formatting, dead-code, whitespace, and flake checks from a checkout root.
- `sudo nixos-rebuild switch --flake "$NH_FLAKE#workstation"` (alias: `nixos-switch` on NixOS)

## Notes for Agents

- Global-scope secret aliases (the `secret` CLI's global config) live in the git-synced file `assets/secret/global.json`; Home Manager symlinks `~/.config/secret/config.json` to it through the `~/.config/nixfiles` stable pointer, so `secret set --global` edits land in the working copy and jj snapshots them — push so other machines see new aliases. Machine-specific overrides belong in `.secret.local.json`.
- Update portable skills in the `agents` repository. Keep only machine-specific overlays in `assets/.agents` and run `nixapply` to deploy them.
- Read `AGENTS_TASTE.md` for undocumented user preferences before making changes. After completing a task, update it only when the session revealed a new durable preference not already documented in the repository instructions.
- Agent-made `jj` revisions carry a session deeplink and a short summary of the initial prompt in the description body (after the first line), prefixed with `prompt_summary:`; keep the first line a lowercase concise title. Use the harness active at request time, not a fixed one: Codex desktop links `codex://threads/<thread-id>` via `$CODEX_THREAD_ID`; T3 Code/OpenCode and other harnesses use their own session id/link from their session store. Summarize the prompt in 1-2 lines after `prompt_summary:`; the deeplink preserves full context.

  ```text
  add ssh multiplexer module

  Session: codex://threads/<thread-id>
  prompt_summary: user wants an ssh multiplexer module shared by both hosts
  ```
- `ast-outline` (installed via `nixbootstrap`) is the primary code-exploration tool, replacing readbro. The canonical agent snippet lives in `assets/.agents/AGENTS.md` inside `<!-- ast-outline:start -->` markers; a Cursor rule is at `assets/.cursor/rules/ast-outline.mdc`.
- `jje <base>` is a shell function (defined in `modules/shell.nix`) that duplicates a commit range (`<base>::@`) then squashes the original — preserves evolution history while producing a single clean commit. Shell reload after applying.
- Optional workspace test configs `.cursor/mcp.json` and `.vscode/mcp.json` now also route through the local Executor instance (`executor mcp`) instead of repo-local MCP servers.
- When adding new reusable repository conventions, document them here so future agents can find them quickly.
- Custom packages live in `packages/<name>/default.nix`, use `finalAttrs`, and are exposed through `perSystem.packages` with `pkgs.callPackage` so `nix-update` can locate them. Prefer an official prebuilt release archive or upstream binary cache over compiling a Rust/Go workspace. When a trustworthy compatible binary exists, pin its source or cache in the flake, expose it through `perSystem.packages`, and verify platform coverage, source provenance, and cache trust before applying. Use source builds only when no compatible prebuilt artifact exists. `modlens` and `modsearch` are packaged from pinned npm tarballs — modsearch additionally vendors `assets/modsearch/package-lock.json` and pins its upstream skill commit — and their skills are overlaid into the generated `.agents` tree by `modules/agents.nix`.
- For standalone Home Manager, a flake's `nixConfig` cannot override restricted daemon settings for an untrusted client. Add each configured binary cache and its public key to `/etc/nix/nix.conf`, and include the login user in `trusted-users`, before applying a cache-backed package.
- `scripts/update-pins.json` is the source of truth for routine package/input updates; run it through `nix run .#update-pins`. Keep coupled lockfile or multi-platform hash updates explicitly manual and document them in `docs/UPDATE_COMMANDS.md`. ModLens/ModSearch provider authentication is runtime-only; never add provider API keys to Nix assets.
- `llm-agents.nix` intentionally does not follow this flake's `nixpkgs`: its pinned package set is what makes the Numtide binary cache usable. Do not add that `follows` edge back without checking the cache impact.
- The pi coding agent is Nix-managed by `modules/pi.nix` with sources under `assets/pi/`: the `pi` binary comes from `inputs.llm-agents`; package extensions are built from the vendored `assets/pi/npm/package-lock.json` via `buildNpmPackage` and **seeded** (copied, writable) into `~/.pi/agent/npm` only when a stamp file shows the pinned tree changed — day-to-day `pi install` tweaks survive nixapply; bumping pins in `piSettings.packages` (+ lockfile + `npmDepsHash`) reseeds. Local extensions are vendored in `assets/pi/extensions` (project-specific skills stay out of the global nix setup). To promote a pi tweak, vendor the new lockfile/pins into `assets/pi/npm`. `settings.json` is also reseeded on pin changes only (pi mutates it freely at runtime). Never `pnpm add -g @earendil-works/pi-coding-agent` or hand-edit `~/.pi/agent` expecting it to persist across pin bumps — change the nixfiles and run `nixapply`. `qmd` (memory search backend for pi-memory) is still installed out-of-band via bun and not yet packaged.
- In the interactive shell, `pn`, `ppnm`, and `pnp` are aliases for `pnpm`. `nodejs_24` and `pnpm` are installed for Nix builds and development use. `nub` (prebuilt GitHub release archive) is on `home.packages` via the coding module.
- `programs.mise` is enabled in `modules/shell.nix`; its bash/zsh hooks are generated at Nix build time by `modules/shell-interactive.nix`. Entering a repo with `mise.toml` puts that project's `.mise/bin` on PATH (e.g. welii `dev`). Do **not** also install mise with `nix profile add nixpkgs#mise` — it conflicts on `bin/mise` during activation and can leave a broken profile. `removeStandaloneMise` strips leftovers before `installPackages`.
- Flake location is path-agnostic: `NH_FLAKE` = `~/.config/nixfiles` (symlink to the clone). Do not hardcode machine-specific clone paths. Use `nixfiles-here` after cloning.
- `cli-tools` lists the curated Nix CLI cockpit (`--term` color map, `--web` HTML). Overview lives under `assets/cli-tools/`; inspired by Vincent-HD/.nixfiles command-line overview.
- **When adding a CLI binary** to `home.packages` (nixpkgs or `packages/`), also update the cockpit: `assets/cli-tools/cli-tools.sh` (`list_term`) and `assets/cli-tools/overview.html` (tool card). Keep the map curated — skip noise; document tools agents/humans should know about.
- Ghostty config is managed by Home Manager (`programs.ghostty` in `modules/terminal.nix`, written to `~/.config/ghostty/config`). Theme is Flexoki Dark. On macOS the official app is used (`package = null`); on Linux the nixpkgs package is installed.
- Custom local Raycast extensions live under `assets/raycast/<name>/` (source of truth). `modules/raycast-local-extensions.nix` seeds them as **writable copies** into `~/RaycastExtensions/<name>` on every activation (node_modules is preserved across reseeds; NOT `~/.config` — Raycast rejects hidden folders as dev-extension sources), so Raycast's `Import Extension` can point at the stable path. After editing an extension, run `nixapply` to reseed, and `pnpm install && pnpm exec ray build` inside `~/RaycastExtensions/<name>` for typecheck/build validation.
