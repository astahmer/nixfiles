# nixfiles

Personal Nix setup with two entry points:

- a direct NixOS host in `hosts/`
- a standalone Home Manager profile for macOS in `homes/`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Layout

- `modules/home-manager/` holds reusable user-level config such as kitty, git, coding tools, and optional Bitwarden integration.
- `modules/nixos/` holds Linux-only system modules like Nix-ld, Docker, and the shared NixOS baseline.
- `hosts/` defines NixOS machines.
- `homes/` defines standalone Home Manager profiles for macOS.

## macOS setup

This machine is set up for standalone Home Manager on `aarch64-darwin` and does not use NixOS or nix-darwin.

Run:

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

- `modules/home-manager/terminal.nix` for kitty defaults
- `modules/home-manager/coding.nix` for dev tools and direnv
- `modules/home-manager/git.nix` for git defaults
- `modules/home-manager/bitwarden.nix` for Bitwarden desktop plus SSH agent socket wiring
- `modules/nixos/coding.nix` for Nix-ld and Docker on Linux

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```
