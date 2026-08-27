# nixfiles

Personal Nix setup with two entry points:

- a direct NixOS host in `hosts/`
- a standalone Home Manager profile for macOS in `hosts/macbook`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Quick Start

Clone this repo anywhere, then create the stable flake symlink and apply:

```bash
git clone <url> ~/wherever/nixfiles
cd ~/wherever/nixfiles
ln -sfn "$(pwd)" ~/.config/nixfiles
nh home switch . -c macbook -b hm-backup
# or, if you're on a NixOS machine
sudo nixos-rebuild switch --flake .#workstation
```

`NH_FLAKE` is always `~/.config/nixfiles` (same on every machine). After the first apply, `nixapply` works from any cwd. Use `nixfiles-here` from the clone root to (re)create the symlink.

On a fresh machine, run `nixbootstrap` once to install the optional external tools and seed Executor/Skepsis. Run `nixcheck` from the checkout root before applying changes.

If Home Manager stops on an existing `*.backup` file from an older manual run, rerun the switch with `-b hm-backup`. That keeps the old files in `*.hm-backup` instead of trying to reuse the same backup suffix.

To add a new module, create a `.nix` file under `modules/`, expose it under `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, then add it to `hosts/macbook/default.nix` or `hosts/workstation/default.nix`. If one file needs both scopes, export both module attrs from that same file.

## Layout

- `modules/` holds reusable modules. Some files export both Home Manager and NixOS modules when a concern spans both scopes.
- `hosts/macbook/default.nix` wires the standalone Home Manager profile for macOS.
- `hosts/workstation/default.nix` wires the NixOS host.
- `assets/.agents/` contains global Copilot skills and is linked into `~/.agents` by Home Manager.
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. `assets/executor/executor.jsonc` documents the catalog (GitHub Copilot, Context7, Chrome DevTools, nixos); `assets/executor/setup.ts` seeds them idempotently after `nixbootstrap` or when the activation hash changes.
- `assets/readbro/` contains the source for readbro (an IR read-cache MCP); it is currently disabled.
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
# 2) Point the stable flake symlink at this clone, then apply
ln -sfn "$(pwd)" ~/.config/nixfiles
nh home switch . -c macbook -b hm-backup
```

After that, `nixapply` works from any directory (`NH_FLAKE=~/.config/nixfiles`).

The default user is `astahmer`. Change `nixfiles.username` in `modules/global-options.nix` if needed.

### Secrets and MCP credentials

The global `secret` command, project-local `.secret.json` files, Bitwarden, and the explicit `.env` projection flow are documented in [`docs/bitwarden.md`](docs/bitwarden.md). Home Manager does not contact Bitwarden during activation. The full secrets system (backends, biometric cache, leak-guarded `secret run`, CI checks, SecretBar) is documented in [`docs/secrets.md`](docs/secrets.md).

The ModLens Gemini (AI Studio) key setup — get, store, project, rotate — is
documented in [`docs/gemini-api-key.md`](docs/gemini-api-key.md).

The global MCP configs under `assets/.config/opencode/opencode.json`, `assets/.cursor/mcp.json`, and `assets/vscode/mcp.json` point at the local Executor instance (`executor mcp`).

## NixOS setup

The NixOS host is named `workstation`.

Run:

```bash
sudo nixos-rebuild switch --flake "$NH_FLAKE#workstation"
# or from the clone: sudo nixos-rebuild switch --flake .#workstation
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
- `modules/bitwarden.nix` for Bitwarden, `rbw`, and the scoped `secret` CLI; see [`docs/bitwarden.md`](docs/bitwarden.md)
- `modules/ryu.nix` for `jj-ryu` on both macOS and NixOS
- `modules/opencodex.nix` for `opencodex` (`ocx`) on both macOS and NixOS
- `modules/agents.nix` for Executor config deployment (`~/.executor/`), MCP configs, and global Copilot agent skills

The coding profile also installs `modlens`, an image-to-structured-evidence CLI for text-only agents, `modsearch`, its web-search/page-fetch sibling, and `agy`, the Google Antigravity CLI that both use as their no-key provider. Their skills are merged into the deployed `~/.agents/skills` tree. Provider sign-in stays a manual runtime step (run `agy` once and complete the browser flow); API keys and credentials stay out of the repository.

## Updating versions

### Flake inputs (nixpkgs + dependencies)

The entire dependency tree is pinned by `flake.lock`. To bump everything to the
latest commit on each input's configured branch:

```bash
nix flake update
```

For a single input (e.g. just nixpkgs):

```bash
nix flake lock --update-input nixpkgs
```

After updating, run `nix flake check` to verify nothing broke, then apply.

### Custom packages (`packages/`)

Packages defined in `packages/<name>/default.nix` use the `finalAttrs` pattern
and are exposed as flake outputs, making them compatible with
[`nix-update`](https://github.com/Mic92/nix-update).

```bash
# Show the configured package and flake-input pins
nix run .#update-pins -- --list

# Preview the routine update set without changing files
nix run .#update-pins -- --dry-run

# Update a selected set
nix run .#update-pins -- --only codex,iris,ryu,zed

# Update and run the fast evaluation checks
nix run .#update-pins -- --validate fast
```

The full registry and platform caveats live in
[`docs/UPDATE_COMMANDS.md`](docs/UPDATE_COMMANDS.md). Iris, Ryu, and Codex are
packaged from upstream release archives, so normal profile updates do not
compile their Go or Rust workspaces. Packages with coupled lockfiles or
per-platform hashes remain explicitly manual in the registry.

After updating, verify with:

```bash
nix flake check
```

### Packages from nixpkgs

Most dependencies come from nixpkgs itself. After a `nix flake update`, simply
apply the profile — the updated nixpkgs revision provides the latest versions.

### Binary cache

The flake declares Numtide's cache for the `llm-agents.nix` packages and the
NixOS module persists it for the local login user. On a standalone macOS or
Linux Home Manager install, the Nix daemon may need the same cache configured
once in `/etc/nix/nix.conf`; if Nix reports that the user is not trusted, add
the cache and the login user there before applying again. The relevant values
are:

```ini
trusted-users = root astahmer
extra-substituters = https://cache.numtide.com
extra-trusted-public-keys = niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g=
```

## Conventions

- Never use `with` expressions. Prefer explicit attribute references such as `pkgs.spotify`, `pkgs.doppler`, `pkgs.git`, or `pkgs."name-with-hyphen"`. Avoid `with pkgs;` or any `with` usage inside modules, functions, or package lists.

## Node tooling

The shell profile installs Node.js and pnpm. `pn`, `ppnm`, and `pnp` are shell aliases for `pnpm`.
`nodejs_24` and `pnpm` are available for Nix builds and development use.

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```

Validate a checkout with:

```bash
nixcheck
```
