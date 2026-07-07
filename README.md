# nixfiles

Personal Nix setup with three entry points:

- a direct NixOS host in `hosts/`
- a standalone Home Manager profile for macOS in `hosts/macbook`
- a standalone Home Manager profile for Linux/Bazzite in `hosts/bazzite`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Quick Start

If you just installed Nix, keep the first run simple:

1. Clone this repo and change into it.
2. Run `nix flake check` to make sure the config evaluates.
3. Apply the profile for your machine.

```bash
nix run nixpkgs#home-manager -- switch -b hm-backup --flake .#macbook
# or, on Linux
nix run nixpkgs#home-manager -- switch -b hm-backup --flake .#bazzite
# or, if you're on a NixOS machine
sudo nixos-rebuild switch --flake .#workstation
```

If Home Manager stops on an existing `*.backup` file from an older manual run, rerun the switch with `-b hm-backup`. That keeps the old files in `*.hm-backup` instead of trying to reuse the same backup suffix.

To add a new module, create a `.nix` file under `modules/`, expose it under `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, then add it to `hosts/macbook/default.nix`, `hosts/bazzite/default.nix`, or `hosts/workstation/default.nix`. If one file needs both scopes, export both module attrs from that same file.

## Layout

- `modules/` holds reusable modules. Some files export both Home Manager and NixOS modules when a concern spans both scopes.
- `hosts/macbook/default.nix` wires the standalone Home Manager profile for macOS.
- `hosts/bazzite/default.nix` wires the standalone Home Manager profile for Linux/Bazzite.
- `hosts/workstation/default.nix` wires the NixOS host.
- `assets/.agents/` contains global Copilot skills and is linked into `~/.agents` by Home Manager.
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. `assets/executor/executor.jsonc` documents the catalog (GitHub Copilot, Context7, Chrome DevTools, nixos); `assets/executor/setup.sh` seeds them idempotently on activation.
- `assets/readbro/` contains the source for readbro (IR read cache MCP (it is currently disabled)
- `.references/` contains cloned reference repositories used for comparison and pattern mining.

## macOS setup

This profile is managed with standalone Home Manager on macOS.

Run the steps below to enable flakes and apply the profile.

```bash
# 1) Enable Nix flakes (if not already enabled)
mkdir -p ~/.config/nix
cat > ~/.config/nix/nix.conf <<'EOF'
experimental-features = nix-command flakes
EOF
```

```bash
# 2) Apply the Home Manager profile
nix run nixpkgs#home-manager -- switch -b hm-backup --flake .#macbook
```

The default user is `astahmer`. Change `flake.username` in `modules/global-options.nix` if needed.

### GitHub token for MCP tools

The Home Manager activation hook in `modules/shell.nix` writes a stable token file at `~/.config/opencode/github-token` for the MCP clients used by the editor integrations.

Resolution order is:

1. Reuse the existing file at `~/.config/opencode/github-token` if it already exists.
2. Use `GITHUB_TOKEN` if it is set in the current environment.
3. Fall back to `GH_TOKEN` if that is set instead.
4. If neither env var is present, ask the `gh` CLI for the current authenticated token with `gh auth token`.

The Executor seeder (`assets/executor/setup.sh`) wires this token into `~/.local/share/executor/auth.json` during activation, where Executor's file provider picks it up for the GitHub Copilot MCP integration. The global MCP configs under `assets/.config/opencode/opencode.json`, `assets/.cursor/mcp.json`, and `assets/vscode/mcp.json` now point at the local Executor instance (`executor mcp`) instead of individual MCP servers.

If you want a fresh token written during a switch, make sure `gh` is logged in or export `GITHUB_TOKEN`/`GH_TOKEN` before running Home Manager.

## Linux setup

The Linux profile is managed with standalone Home Manager and is meant to cover Bazzite-style setups without requiring NixOS.

Run:

```bash
nix run nixpkgs#home-manager -- switch -b hm-backup --flake .#bazzite
```

The default user is `astahmer`. Change `flake.username` in `modules/global-options.nix` if needed.

## NixOS setup

The NixOS host is named `workstation`.

Run:

```bash
sudo nixos-rebuild switch --flake .#workstation
```

Add your own hardware-specific config before treating it as a real machine profile.

## Modules worth reusing

- `modules/base.nix` for the shared state versions plus the NixOS baseline
- `modules/coding.nix` for macOS dev tools and Linux Nix-ld/Docker
- `modules/terminal.nix` for Ghostty on macOS and kitty on Linux
- `modules/shell.nix` for shell integrations and prompt tools
- `modules/jujutsu.nix` for Jujutsu config
- `modules/macos-apps.nix` for macOS app packages
- `modules/linux-apps.nix` for Linux desktop app packages
- `modules/tools.nix` for jjui, lazygit, and lazydocker
- `modules/launcher.nix` for Vicinae on Linux
- `modules/git.nix` for git defaults
- `modules/bitwarden.nix` for Bitwarden desktop plus SSH agent socket wiring
- `modules/ryu.nix` for `jj-ryu` on both macOS and NixOS
- `modules/agents.nix` for Executor config deployment (`~/.executor/`), MCP configs, and global Copilot agent skills

## Updating `jj-ryu`

`packages/ryu.nix` is the single source of truth for the package definition.
`scripts/build-ryu.nix` is only a helper for rebuilding that package in isolation while you refresh hashes.

To bump upstream:

1. Update the `rev` or `sha256` in `packages/ryu.nix`.
2. Run `nix build -f scripts/build-ryu.nix --no-link` to verify the package and refresh `cargoHash` if needed.
3. Re-run `nix run nixpkgs#home-manager -- build --flake .#macbook` or `nix flake check`.

## Conventions

- Never use `with` expressions. Prefer explicit attribute references such as `pkgs.spotify`, `pkgs.doppler`, `pkgs.git`, or `pkgs."name-with-hyphen"`. Avoid `with pkgs;` or any `with` usage inside modules, functions, or package lists.

## Node tooling

The shell profile installs [nub](https://github.com/nubjs/nub) and aliases the common Node.js package-manager commands to it:

| Alias | Resolves to |
|-------|-------------|
| `pnpm` | `nub` |
| `pn`   | `nub` |
| `ppnm` | `nub` |
| `npm`  | `nub` |
| `npx`  | `nubx` |
| `pnpmi` | `nub i` |

This keeps day-to-day commands (`pnpm install`, `pnpm run`, `npx`, etc.) fast while nub runs in pnpm-compatible mode. `nodejs_26` is still installed and remains on `PATH` for scripts and tools that need the real Node binary, and the Nix package builds (`readbro-package.nix`, `hunk-package.nix`) still use stock `pnpm`/`node`/`bun` for reproducibility.

If a project breaks under the nub aliases, run the real tool directly (`command pnpm …`, `/nix/store/.../bin/node …`, etc.).

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```
