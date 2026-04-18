---
name: nix-module-patterns
description: Maintains this flake-parts/import-tree Nixfiles repo and its module conventions. Use when adding or refactoring NixOS or Home Manager modules, wiring hosts or homes, or applying repo conventions like explicit pkgs.<name> references.
---

# Nix Module Patterns

## Quick Rules

- Keep reusable logic in `modules/<name>.nix`; `import-tree` discovers it automatically.
- Keep NixOS and Home Manager concerns split unless a module truly spans both scopes.
- Prefer dedicated platform modules over inline `lib.mkIf` branches when the repo already has a split.
- Use explicit package references: `pkgs.spotify`, `pkgs.git`, `pkgs.doppler`, or `pkgs."name-with-hyphen"`. Avoid `with pkgs;` for package lists.
- Keep host and home files thin; wire modules in `hosts/<name>/default.nix` or `homes/<name>/default.nix`.

## Workflow

1. Read one or two nearby modules to match style.
2. Add or edit the smallest module that owns the behavior.
3. Wire the module into the host or home profile.
4. Validate with `nix flake check` or the smallest available syntax or eval check.

## Notes

- Flake inputs are usually available by lexical closure in module files; do not add `specialArgs` just to pass inputs around.
- For hyphenated package names, use `pkgs."name-with-hyphen"`.
- Prefer focused modules over architecture churn unless the repo already has a clear split to follow.
