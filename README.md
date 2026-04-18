# nixfiles

Personal Nix setup with two entry points:

- a direct NixOS host in `hosts/`
- a standalone Home Manager profile for macOS in `homes/`

The repo follows the same broad pattern as the reference configs: `flake-parts` for wiring, `import-tree` for auto-discovery, reusable modules under `modules/`, and thin host/profile files that pick what to enable.

## Layout

- `modules/home-manager/` holds reusable user-level config such as terminal apps, shell setup, git, Jujutsu, macOS apps, coding tools, and optional Bitwarden integration.
- `modules/home-manager/linux-apps.nix` and `modules/home-manager/macos-apps.nix` hold platform-specific desktop app packages.
- `modules/nixos/` holds Linux-only system modules like Nix-ld, Docker, and the shared NixOS baseline.
- `hosts/` defines the NixOS machine.
- `homes/` defines standalone Home Manager profiles for macOS.

## macOS setup

This machine is managed with standalone Home Manager on macOS.

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

- Use explicit package references in modules: `pkgs.spotify`, `pkgs.doppler`, `pkgs.git`, or `pkgs."name-with-hyphen"`.
- Avoid `with pkgs;` for package lists in new modules or when updating existing ones.

## Common workflow

Inspect the flake outputs with:

```bash
nix flake show
```
