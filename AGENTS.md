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

- `assets/.agents/` — global agent tree. `assets/.agents/skills/ast-outline/SKILL.md` — ast-outline code-exploration skill (tree-sitter-based CLI for outlines, digests, symbol extraction, and AST-aware grep). ast-outline is installed globally via `uv tool install` by `nixbootstrap`. Global MCP templates under `assets/.cursor/mcp.json`, `assets/vscode/mcp.json`, and `assets/.config/opencode/opencode.json`; Home Manager deploys them.
- Agent config source of truth is `assets/.agents/` and `assets/.cursor/`. Home Manager deploys to `~/.agents`, `~/.cursor/rules`, and `~/.cursor/hooks*`. Do not manually copy into `$HOME`; run `nixapply` to apply. `initagent` copies from the deployed `~/.agents`, not the clone.
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. Agents connect only to Executor over MCP; Executor itself hosts the GitHub Copilot, Context7, and Chrome DevTools integrations. `assets/executor/setup.ts` seeds these integrations idempotently after `nixbootstrap` and when activation inputs change.
- `readbro` is superseded by `ast-outline`. Its source remains in `assets/readbro/` for reference but is no longer deployed — neither as an MCP server nor as an agent skill. The readbro skill (`assets/.agents/skills/readbro/`) is excluded from Home Manager deployment via a source filter.
- `~/.references/` contains globally-shared cloned reference repositories used for comparison and pattern mining. Per-project `.references/` is used only as an escape hatch.

## Reference Repos

- Reference repos are cloned to `~/.references/<name>` by default (shared globally). Use the `reference-repository` skill to add or read them.
- To keep a clone local to a project (escape hatch), explicitly ask to "add locally" — it goes into `<project>/.references/<name>`.
- Each project tracks its references in `reference-repos.md` at the project root.
- Read the clone's `AGENTS.md` before inspecting implementation details.
- Keep reference repos read-only unless the user asks to update them.

## Nix Conventions

- Never use `with` expressions. Always prefer explicit attribute references (for example: `pkgs.spotify`, `pkgs.git`, or `pkgs."name-with-hyphen"`) or fully-qualified attribute paths. This rule applies everywhere in modules, package lists, and functions — not just to `pkgs`.
- Keep NixOS and Home Manager concerns split when the repo already has separate modules.
- Use thin host/profile files that only wire modules together.

## Apply Commands

Stable flake pointer: `~/.config/nixfiles` → clone (`NH_FLAKE`). Create with `nixfiles-here` from the clone root.

- `nh home switch -c macbook -b hm-backup` (alias: `nixapply`)
- `nh home switch -c macbook -b hm-backup -u` (alias: `nixupdate`)
- `nixfiles-bootstrap` (alias: `nixbootstrap`) installs optional external tools and seeds Executor/Skepsis.
- `nixfiles-check` (alias: `nixcheck`) runs formatting, dead-code, whitespace, and flake checks from a checkout root.
- `sudo nixos-rebuild switch --flake "$NH_FLAKE#workstation"` (alias: `nixos-switch` on NixOS)

## Notes for Agents

- `assets/.agents` is the source of the global skills tree; update it when adding or changing global skills.
- Read `AGENTS_TASTE.md` for undocumented user preferences before making changes. After completing a task, update it only when the session revealed a new durable preference not already documented in the repository instructions.
- Agent-made `jj` revisions carry a session deeplink and a short summary of the initial prompt in the description body (after the first line); keep the first line a lowercase concise title. Use the harness active at request time, not a fixed one: Codex desktop links `codex://threads/<thread-id>` via `$CODEX_THREAD_ID`; T3 Code/OpenCode and other harnesses use their own session id/link from their session store. Summarize the prompt in 1-2 lines; the deeplink preserves full context.
- `ast-outline` (installed via `nixbootstrap`) is the primary code-exploration tool, replacing readbro. The canonical agent snippet lives in `assets/.agents/AGENTS.md` inside `<!-- ast-outline:start -->` markers; a Cursor rule is at `assets/.cursor/rules/ast-outline.mdc`.
- `jje <base>` is a shell function (defined in `modules/shell.nix`) that duplicates a commit range (`<base>::@`) then squashes the original — preserves evolution history while producing a single clean commit. Shell reload after applying.
- Optional workspace test configs `.cursor/mcp.json` and `.vscode/mcp.json` now also route through the local Executor instance (`executor mcp`) instead of repo-local MCP servers.
- When adding new reusable repository conventions, document them here so future agents can find them quickly.
- Custom packages live in `packages/<name>/default.nix`, use `finalAttrs`, and are exposed through `perSystem.packages` with `pkgs.callPackage` so `nix-update` can locate them. Prefer upstream release archives over compiling a Rust/Go workspace when the project publishes binaries. `modlens` is packaged from pinned npm tarballs and its bundled skill is overlaid into the generated `.agents` tree by `modules/agents.nix`.
- `scripts/update-pins.json` is the source of truth for routine package/input updates; run it through `nix run .#update-pins`. Keep coupled lockfile or multi-platform hash updates explicitly manual and document them in `docs/UPDATE_COMMANDS.md`. ModLens provider setup is runtime-only; never add `agy` authentication or provider credentials to Nix assets.
- `llm-agents.nix` intentionally does not follow this flake's `nixpkgs`: its pinned package set is what makes the Numtide binary cache usable. Do not add that `follows` edge back without checking the cache impact.
- In the interactive shell, `pn`, `ppnm`, and `pnp` are aliases for `pnpm`. `nodejs_24` and `pnpm` are installed for Nix builds and development use. `nub` (v0.6.0 flake input) is on `home.packages` via the coding module.
- `programs.mise` is enabled in `modules/shell.nix` (zsh + bash activate). Entering a repo with `mise.toml` puts that project's `.mise/bin` on PATH (e.g. welii `dev`). Do **not** also install mise with `nix profile add nixpkgs#mise` — it conflicts on `bin/mise` during activation and can leave a broken profile. `removeStandaloneMise` strips leftovers before `installPackages`.
- Flake location is path-agnostic: `NH_FLAKE` = `~/.config/nixfiles` (symlink to the clone). Do not hardcode machine-specific clone paths. Use `nixfiles-here` after cloning.
- `cli-tools` lists the curated Nix CLI cockpit (`--term` color map, `--web` HTML). Overview lives under `assets/cli-tools/`; inspired by Vincent-HD/.nixfiles command-line overview.
- **When adding a CLI binary** to `home.packages` (nixpkgs or `packages/`), also update the cockpit: `assets/cli-tools/cli-tools.sh` (`list_term`) and `assets/cli-tools/overview.html` (tool card). Keep the map curated — skip noise; document tools agents/humans should know about.
- Ghostty config is managed by Home Manager (`programs.ghostty` in `modules/terminal.nix`, written to `~/.config/ghostty/config`). Theme is Flexoki Dark. On macOS the official app is used (`package = null`); on Linux the nixpkgs package is installed.
