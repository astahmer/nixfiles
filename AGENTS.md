# nixfiles — Agent Guidelines

This repository is a Nix flake for a single user with two entry points:

- a NixOS host in `hosts/workstation`
- a standalone macOS Home Manager profile in `hosts/macbook`

The repo uses `flake-parts` plus `import-tree`, so `.nix` files under `modules/`, `hosts/`, and `homes/` are discovered automatically.

## Quick Start

If you are new to Nix, start by cloning the repo, entering it, and running `nix flake check`.

Then apply the profile that matches the machine:

```bash
home-manager switch --flake .#macbook
# or, on Linux
sudo nixos-rebuild switch --flake .#workstation
```

To add a module, create a file under `modules/`, export it as `config.flake.modules.homeManager.<name>` or `config.flake.modules.nixos.<name>`, and wire it into `hosts/macbook/default.nix` or `hosts/workstation/default.nix`. If the concern spans both scopes, keep both outputs in the same file.

## Layout

- `modules/` contains reusable modules. Some files export both Home Manager and NixOS modules when needed.
- `hosts/macbook/default.nix` contains the standalone macOS Home Manager profile.
- `hosts/workstation/default.nix` contains the NixOS host.
- `assets/.agents/` contains global Copilot skills and is linked into `~/.agents` by Home Manager.
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

- `home-manager switch --flake .#macbook`
- `sudo nixos-rebuild switch --flake .#workstation`

## Notes for Agents

- `assets/.agents` is the source of the global skills tree; update it when adding or changing global skills.
- When adding new reusable repository conventions, document them here so future agents can find them quickly.
