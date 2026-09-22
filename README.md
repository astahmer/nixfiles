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
- The pinned `agents` flake input supplies reusable skills and an optional project `AGENTS.md` baseline. `assets/.agents/` contains the Nix-local global contract and machine overlays; Home Manager combines the skill trees and deploys the local contract to `~/.agents/` and `~/.codex/AGENTS.md` on every machine.
- The source split and migration procedure are documented in [`docs/agent-sources.md`](docs/agent-sources.md).
- `assets/tokitoki/` contains the value-free Tokitoki configuration template; secret-backed runtime projection and macOS startup are documented in [`docs/tokitoki.md`](docs/tokitoki.md).
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
nix run ~/.config/nixfiles#configure-nix-cache
nh home switch . -c macbook -b hm-backup
```

The cache setup asks for the macOS administrator password once. It configures
the Nix daemon to enable `nix-command` and `flakes`, use the Numtide, devenv,
and Cachix binary caches, enable parallel jobs, and trust the extra cache keys.
Rerun the command after changing Nix daemon settings or moving to a new machine;
it is idempotent.

If an already-deployed older helper fails with `nix-command is disabled`, add
the feature to the main daemon config once before retrying. Put it in
`/etc/nix/nix.conf` so the older helper cannot overwrite it in its managed
include:

```bash
if ! sudo /usr/bin/grep -Fqx 'extra-experimental-features = nix-command flakes' /etc/nix/nix.conf; then
  printf '%s\n' 'extra-experimental-features = nix-command flakes' | sudo /usr/bin/tee -a /etc/nix/nix.conf >/dev/null
fi
sudo /bin/launchctl kickstart -k system/org.nixos.nix-daemon
nixapply
```

After that, `nixapply` works from any directory (`NH_FLAKE=~/.config/nixfiles`).

The default user is `astahmer`. Change `nixfiles.username` in `modules/global-options.nix` if needed.

### Secrets and MCP credentials

The global `secret` command, project-local `.secret.json` files, Bitwarden, and the explicit `.env` projection flow are documented in [`docs/bitwarden.md`](docs/bitwarden.md). Home Manager does not contact Bitwarden during activation. The full secrets system (backends, biometric cache, leak-guarded `secret run`, CI checks, SecretBar) is documented in [`docs/secrets.md`](docs/secrets.md).

Tokitoki's secret-backed configuration and automatic macOS menu-bar startup are
documented in [`docs/tokitoki.md`](docs/tokitoki.md).

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

## Nix store maintenance

Run this occasionally—monthly, or when the Nix store has grown unusually
large—to remove old profile generations, collect unreachable paths, and
deduplicate the remaining store. The first command is intentionally first:
deleting old generations can make more paths collectible.

```bash
# Remove generations older than seven days and collect what becomes unreachable.
sudo nix-collect-garbage --delete-older-than 7d

# Run an explicit store GC with the feature enabled for the elevated Nix command.
sudo nix --extra-experimental-features nix-command store gc

# Deduplicate identical files in the remaining store (can be CPU/IO intensive).
sudo nix --extra-experimental-features nix-command store optimise
```

Check available space before and after with `df -h /`. `nh clean all` may fail
on a standalone macOS install if root's `/etc/nix/nix.conf` does not enable
`nix-command`; the explicit commands above pass the feature to the elevated
Nix invocation directly. If you prefer `nh`, pass the setting through the
environment and give root its own home directory:

```bash
sudo -H env NIX_CONFIG='extra-experimental-features = nix-command' nh clean all
```

Do not append `--extra-experimental-features` to `nh clean all`; that option is
accepted by `nix`, not by `nh`.

## Workspace disk audit

Old JJ workspaces and Git worktrees can retain duplicate `node_modules`, build
outputs, and repository objects. The Nix-managed audit command reports JJ
workspaces and Git worktrees without deleting or forgetting anything:

```bash
jj-workspace-audit --root "$HOME/dev" --older-than-days 30 | column -t -s $'\t'
```

The audit invokes `jj status` to detect dirty workspaces, so JJ may create
ordinary snapshot operations while it runs; it never rewrites or deletes
commits.

Rows marked `review` are only candidates: age and cleanliness do not prove
that a workspace is unused. `protected-root` is the main checkout,
`protected-dirty` has uncommitted changes, and `recent` is younger than the
chosen threshold. The date is the checked-out commit date, not proof of last
human use.

Before reclaiming a `review` row, inspect the exact path and workspace name,
check that no process has it open, and verify its branch/bookmarks are not
needed:

```bash
lsof +D /path/to/workspace
jj -R /path/to/workspace status
jj -R /path/to/workspace workspace list
```

For a JJ workspace, run `jj workspace forget <name>` from another workspace,
then move or delete the exact directory only after review. For a Git worktree,
use `git -C /path/to/main worktree remove /path/to/worktree` only after the
same checks. To find only stale Git worktree metadata without deleting it, use
the dry run first:

```bash
git -C /path/to/main worktree prune --dry-run
```

There is intentionally no automated deletion mode.

## Modules worth reusing

- `modules/base.nix` for the shared state versions plus the NixOS baseline
- `modules/coding.nix` for macOS dev tools and Linux Nix-ld/Docker
- `modules/terminal.nix` for Ghostty on macOS and kitty on Linux
- `modules/shell.nix` for shell integrations and prompt tools
- `modules/jujutsu.nix` for Jujutsu config
- `modules/macos-apps.nix` for macOS app packages
- `modules/shiftshift.nix` for the pinned shiftshift app bundle and config seed
- `modules/linux-apps.nix` for Linux desktop app packages
- `modules/tools.nix` for jjui, lazygit, and lazydocker
- `modules/launcher.nix` for Vicinae on Linux
- `modules/git.nix` for git defaults
- `modules/bitwarden.nix` for Bitwarden, `rbw`, and the scoped `secret` CLI; see [`docs/bitwarden.md`](docs/bitwarden.md)
- `modules/ryu.nix` for `jj-ryu` on both macOS and NixOS
- `modules/opencodex.nix` for `opencodex` (`ocx`) on both macOS and NixOS
- `modules/tokitoki.nix` for Tokitoki usage analytics, secret-backed quota keys, and the macOS menu-bar LaunchAgent
- `modules/agents.nix` for Executor config deployment (`~/.executor/`), MCP configs, and global Copilot agent skills

The coding profile also installs `modlens`, an image-to-structured-evidence CLI for text-only agents, and `modsearch`, its web-search/page-fetch sibling. Their skills are merged into the deployed `~/.agents/skills` tree. Both previously used the Google Antigravity CLI (`agy`) as a no-key provider; that integration was removed because it breached the Antigravity Additional Terms of Service (Section 6 bans using third-party tools against the Service via Antigravity OAuth). Configure a provider API key per tool instead; API keys and credentials stay out of the repository.

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

# Update every registered pin, validate, and apply Home Manager
nixupdateall
```

The full registry and platform caveats live in
[`docs/UPDATE_COMMANDS.md`](docs/UPDATE_COMMANDS.md). Iris, Ryu, and Codex are
packaged from upstream release archives, so normal profile updates do not
compile their Go or Rust workspaces. Packages with coupled lockfiles or
per-platform hashes remain explicitly manual in the registry.

`nixupdateall` is the convenient daily command: it runs the complete enabled
update registry (all flake inputs plus routine package releases), runs the fast
checks, and then applies the macOS profile. Entries marked manual are reported
by the registry and still require their coordinated update procedure.

After updating, verify with:

```bash
nix flake check
```

### Packages from nixpkgs

Most dependencies come from nixpkgs itself. After a `nix flake update`, simply
apply the profile — the updated nixpkgs revision provides the latest versions.

### Binary cache

The flake declares Numtide's cache for the `llm-agents.nix` packages and
Devenv's Cachix caches for the prebuilt `devenv` CLI. The NixOS module persists
them for the local login user. On a standalone macOS or Linux Home Manager
install, the Nix daemon must have the same caches configured once in
`/etc/nix/nix.conf`; a flake's `nixConfig` is ignored for restricted settings
when the client is not trusted. Add the cache and the login user there before
applying. The `nixfiles-configure-nix-cache` helper configures these settings,
including `nix-command` and `flakes`, on macOS:

```ini
trusted-users = root astahmer
extra-experimental-features = nix-command flakes
extra-substituters = https://cache.numtide.com https://devenv.cachix.org https://cachix.cachix.org
extra-trusted-public-keys = niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g= devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw= cachix.cachix.org-1:eWNHQldwUO7G2VkjpnjDbWwy4KQ/HNxht7H4SSoMckM=
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
