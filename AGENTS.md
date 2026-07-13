# nixfiles — Agent Guidelines

This repository is a Nix flake for a single user with two entry points:

- a NixOS host in `hosts/workstation`
- a standalone macOS Home Manager profile in `hosts/macbook`

The repo uses `flake-parts` plus `import-tree`, so `.nix` files under `modules/` and `hosts/` are discovered automatically.

## Quick Start

If you are new to Nix, start by cloning the repo, entering it, and running `nix flake check`.

Then apply the profile that matches the machine:

```bash
nix run nixpkgs#home-manager -- switch -b backup --flake .#macbook
# or, on Linux
sudo nixos-rebuild switch --flake .#workstation
```

To add a module, create a file under `modules/`, export it as `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, and wire it into `hosts/macbook/default.nix` or `hosts/workstation/default.nix`. If the concern spans both scopes, keep both outputs in the same file.

## Layout

- `modules/` contains reusable modules. Some files export both Home Manager and NixOS modules when needed.
- `hosts/macbook/default.nix` contains the standalone macOS Home Manager profile.
- `hosts/workstation/default.nix` contains the NixOS host.
- `assets/.agents/` — global agent tree. `assets/.agents/skills/ast-outline/SKILL.md` — ast-outline code-exploration skill (tree-sitter-based CLI for outlines, digests, symbol extraction, and AST-aware grep). ast-outline is installed globally via `uv tool install` (managed by the `aiCliInstall` activation in `modules/shell.nix`). Global MCP templates under `assets/.cursor/mcp.json`, `assets/vscode/mcp.json`, and `assets/.config/opencode/opencode.json`; Home Manager deploys them.
- Agent config source of truth is `assets/.agents/` and `assets/.cursor/`. Home Manager deploys to `~/.agents`, `~/.cursor/rules`, and `~/.cursor/hooks*`. Do not manually copy into `$HOME`; run `nix run nixpkgs#home-manager -- switch -b backup --flake .#macbook` to apply.
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. Agents connect only to Executor over MCP; Executor itself hosts the GitHub Copilot, Context7, and Chrome DevTools integrations. `assets/executor/setup.sh` seeds these integrations idempotently on activation.
- `readbro` is superseded by `ast-outline`. Its source remains in `assets/readbro/` for reference but is no longer deployed — neither as an MCP server nor as an agent skill. The readbro skill (`assets/.agents/skills/readbro/`) is excluded from Home Manager deployment via a source filter.
- `.references/` contains cloned reference repositories used for comparison and pattern mining.

## Reference Repos

- When cloning a reference repo into `.references/<name>`, keep its `AGENTS.md` at the repo root.
- Read that `AGENTS.md` before inspecting the repo's implementation details.
- Keep reference repos isolated from the main repo and do not edit them unless the user asks.

## Nix Conventions

- Never use `with` expressions. Always prefer explicit attribute references (for example: `pkgs.spotify`, `pkgs.git`, or `pkgs."name-with-hyphen"`) or fully-qualified attribute paths. This rule applies everywhere in modules, package lists, and functions — not just to `pkgs`.
- Keep NixOS and Home Manager concerns split when the repo already has separate modules.
- Use thin host/profile files that only wire modules together.

## Apply Commands

- `nix run nixpkgs#home-manager -- switch -b backup --flake .#macbook`
- `sudo nixos-rebuild switch --flake .#workstation`

## Notes for Agents

- `assets/.agents` is the source of the global skills tree; update it when adding or changing global skills.
- `ast-outline` (installed via `uv tool install`, managed in `modules/shell.nix` activation) is the primary code-exploration tool, replacing readbro. The canonical agent snippet lives in `assets/.agents/AGENTS.md` inside `<!-- ast-outline:start -->` markers; a Cursor rule is at `assets/.cursor/rules/ast-outline.mdc`.
- `jje <base>` is a shell function (defined in `modules/shell.nix`) that duplicates a commit range (`<base>::@`) then squashes the original — preserves evolution history while producing a single clean commit. Shell reload after applying.
- Optional workspace test configs `.cursor/mcp.json` and `.vscode/mcp.json` now also route through the local Executor instance (`executor mcp`) instead of repo-local MCP servers.
- When adding new reusable repository conventions, document them here so future agents can find them quickly.
- In the interactive shell, `pnpm`, `npm`, `pn`, `ppnm`, and `npx` are aliased to `nub`/`nubx`. `nodejs_26` and the real `pnpm` tooling remain installed for Nix builds and fallback use.
