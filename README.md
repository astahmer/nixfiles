# nixfiles

Personal Nix setup with two entry points:

- a direct NixOS host in `hosts/`
- a standalone Home Manager profile for macOS in `homes/`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Quick Start

If you just installed Nix, keep the first run simple:

1. Clone this repo and change into it.
2. Run `nix flake check` to make sure the config evaluates.
3. Apply the profile for your machine.

```bash
home-manager switch --flake .#macbook
# or, on Linux
sudo nixos-rebuild switch --flake .#workstation
```

To add a new module, create a `.nix` file under `modules/`, expose it under `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, then add it to `homes/macbook/default.nix` or `hosts/workstation/default.nix`.

## Layout

- `modules/home-manager/` holds reusable user-level config such as terminal apps, shell setup, git, Jujutsu, macOS apps, coding tools, and optional Bitwarden integration.
- `modules/home-manager/linux-apps.nix` and `modules/home-manager/macos-apps.nix` hold platform-specific desktop app packages.
- `modules/nixos/` holds Linux-only system modules like Nix-ld, Docker, and the shared NixOS baseline.
- `hosts/` defines the NixOS machine.
- `homes/` defines standalone Home Manager profiles for macOS.

## macOS setup

This machine is managed with standalone Home Manager on macOS.

Run the steps below to enable flakes, install the `home-manager` CLI if needed, and apply the profile.

```bash
# 1) Enable Nix flakes (if not already enabled)
mkdir -p ~/.config/nix
cat > ~/.config/nix/nix.conf <<'EOF'
experimental-features = nix-command flakes
EOF
```

```bash
# 2) Install the `home-manager` CLI into your user profile (if missing)
nix profile add nixpkgs#home-manager
```

```bash
# 3) Open a new shell so your profile bins are on PATH (if needed)
exec $SHELL
```

```bash
# 4) Apply the Home Manager profile
home-manager switch --flake .#macbook
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

- `modules/home-manager/terminal.nix` for Ghostty on macOS and kitty on Linux
- `modules/home-manager/shell.nix` for shell integrations and prompt tools
- `modules/home-manager/jujutsu.nix` for Jujutsu config
- `modules/home-manager/macos-apps.nix` for macOS app packages
- `modules/home-manager/linux-apps.nix` for Linux desktop app packages
- `modules/home-manager/tools.nix` for jjui, lazygit, lazydocker, and Zed
- `modules/home-manager/launcher.nix` for Vicinae on Linux
- `modules/home-manager/coding.nix` for dev tools
- `modules/home-manager/git.nix` for git defaults
- `modules/home-manager/bitwarden.nix` for Bitwarden desktop plus SSH agent socket wiring
- `modules/nixos/coding.nix` for Nix-ld and Docker on Linux

## Conventions

- Never use `with` expressions. Prefer explicit attribute references such as `pkgs.spotify`, `pkgs.doppler`, `pkgs.git`, or `pkgs."name-with-hyphen"`. Avoid `with pkgs;` or any `with` usage inside modules, functions, or package lists.

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```
