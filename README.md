# nixfiles

Personal Nix setup with three entry points:

- a direct NixOS host in `hosts/`
- a nix-darwin host for macOS in `hosts/`
- a standalone Home Manager profile for macOS in `homes/`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Layout

- `modules/home-manager/` holds reusable user-level config such as terminal apps, git, coding tools, and optional Bitwarden integration.
- `modules/darwin/` holds macOS system modules like Homebrew and Home Manager integration.
- `modules/nixos/` holds Linux-only system modules like Nix-ld, Docker, and the shared NixOS baseline.
- `hosts/` defines NixOS and nix-darwin machines.
- `homes/` defines standalone Home Manager profiles for macOS.

## macOS setup

This machine is now set up with nix-darwin plus Home Manager and declarative Homebrew.

Run:

```bash
sudo darwin-rebuild switch --flake .#macbook
```

The standalone Home Manager profile is still available with:

```bash
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
- `modules/home-manager/tools.nix` for jjui, lazygit, lazydocker, and Zed
- `modules/home-manager/launcher.nix` for Vicinae on Linux
- `modules/home-manager/coding.nix` for dev tools and direnv
- `modules/home-manager/git.nix` for git defaults
- `modules/home-manager/bitwarden.nix` for Bitwarden desktop plus SSH agent socket wiring
- `modules/nixos/coding.nix` for Nix-ld and Docker on Linux

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```
