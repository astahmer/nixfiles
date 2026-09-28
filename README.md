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
- The pinned `agents` flake input is the base (user-global `AGENTS.md` contract + portable skills); `assets/.agents/` overlays machine-specific skills and preferences. Home Manager combines both and deploys the contract to `~/.agents/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.config/opencode/AGENTS.md`, and `~/.copilot/instructions/` on every machine.
- The source split and migration procedure are documented in [`docs/agent-sources.md`](docs/agent-sources.md).
- `assets/tokitoki/` contains the value-free Tokitoki configuration template; secret-backed runtime projection and macOS startup are documented in [`docs/tokitoki.md`](docs/tokitoki.md).
- `assets/executor/` configures the local [Executor](https://executor.sh) integration layer. `assets/executor/executor.jsonc` documents the catalog (GitHub Copilot, Context7, Chrome DevTools, nixos); `assets/executor/setup.ts` seeds them idempotently after `nixbootstrap` or when the activation hash changes.
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

## Docker and package cache cleanup

Inspect the daemon context and usage first. Broad Docker pruning removes
stopped containers (including their writable layers), unused networks, unused
images, and build cache. Keep database volumes separate.

```bash
rtk docker context show
rtk docker system df --verbose
rtk docker ps --all --size
rtk docker system prune --all
rtk pnpm store prune
```

For an already reviewed context and scope, `rtk docker system prune -af` is the
noninteractive equivalent. It does not prune volumes. For build cache alone,
use `rtk docker builder prune --all`; inspect `rtk docker buildx ls` and
`rtk docker buildx du` before `rtk docker buildx prune --all` for separate
Buildx caches. Pruning caches can require later downloads or rebuilds.
Detailed audit and cleanup recipes live in
[RECIPES.md](assets/.agents/skills/disk-space-cleanup/RECIPES.md).

## Shell history search

Atuin owns Ctrl+R in Bash and Zsh with fuzzy, global history search. Up-arrow
keeps normal shell behavior; Enter selects a command for editing. History is
local, automatic sync is disabled, and Atuin's secret filter is enabled.
After `nixapply`, open a new terminal or run `exec "$SHELL" -l` to load hooks
in an existing terminal. Import existing history once with
`rtk atuin import auto` from your usual interactive shell.

## Workspace disk audit

The [jjw source repository](https://github.com/astahmer/jjw) provides an
interactive workspace browser and fast reports. Running `jjw` in a terminal
opens the browser; redirected output prints a fast table. In the browser, `/`
starts a live
fuzzy filter, `s` cycles sort fields, `v` reverses the sort, `u` checks dirty
state, `z` measures workspace size, and `ctrl+r` rescans. State and size checks
run in the background. Use `jjw list` for reports and scripts; it skips status
checks by default, so its `STATE` column says `unchecked`. `review` means the
workspace is old enough to inspect, not that it is clean. `--state` and
`--action` list filters enable status checks automatically. Choose a structured
output format when another command needs the report:

```bash
jjw list
jjw list --check-state
jjw list --format json > workspaces.json
jjw list --format tsv
jjw list --age-basis created --older-than-days 30
jjw list --sort last-change
jjw list --sort age --age-basis created --reverse
jjw list --sort size
jjw list --size --format json
```

`--sort` supports `last-change`, `age`, `created`, `size`, `name`,
`repository`, `state`, and `action`. Last-change and created sorts show newest
first; age shows oldest first; size shows largest first; state puts dirty and
unknown workspaces first; action puts review candidates first. `--reverse`
flips that order. Ties use repository and path for stable output. Sorting by
age follows `--age-basis`. Sorting by state or action enables `--check-state`
and its slower status checks.

Workspace size is opt-in because it walks each selected workspace. `--size`
adds a human-readable table column and `size_bytes` to structured output;
`--sort size` measures automatically. The count sums regular-file byte lengths,
skips `.jj` and `.git` metadata, and does not follow symlinks. Table sizes use
decimal units; structured output keeps exact bytes. It describes checked-out
workspace contents, not shared repository storage or exact disk space reclaimed
by deleting the workspace. The browser measures size on demand with `z` or when
sorted by size.

Age is based on the workspace's last change by default. Use
`--age-basis created` to compare workspace creation age instead. JJ last-change
dates come from the workspace commit; Git dates come from `HEAD`. They do not
prove last human use. Creation dates use filesystem birth time where supported
and marker modification time as a fallback. The default JJ workspace is
omitted unless `--with-default` is supplied. A path shared by JJ and Git is
listed once with source `jj+git`.

With `--check-state`, rows marked `review` are clean workspaces at or beyond
`--older-than-days`; `protected-root`, `protected-current`, `protected-dirty`,
and `protected-unknown` rows cannot be removed. Run `jjw cleanup` to filter and
select old-enough candidates with `fzf`. It checks each selected workspace's
current status and age after confirmation, then forgets JJ workspaces and
removes their directories or asks Git to remove its worktree. It never forces
removal.

`--check-state` runs `jj status` to inspect JJ workspaces, which can create
normal JJ snapshot operations. It does not rewrite commits. Cleanup runs the
same check only for selected workspaces immediately before removal. Before
cleanup, confirm that the selected path is no longer needed and has no process
using it.

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

The coding profile also installs `calldiff`, a call-stack diff CLI for agentic
code review; its skill is merged into the deployed `~/.agents/skills` tree.

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
