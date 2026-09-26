---
name: disk-space-cleanup
description: Audit macOS disk usage and reclaim space safely across Docker and OrbStack, databases, package stores, caches, and workspaces. Use when the user asks to free disk space, investigate low storage, or remove stale development data.
---

# Disk Space Cleanup (macOS)

Audit first, then make the narrowest cleanup that fits the user's request.
Read [RECIPES.md](RECIPES.md) for concrete commands before inspecting or
removing candidates.

## Workflow

1. Measure overall pressure and rank large paths. Include shared reference
   clones and Codex session logs in the user-space scan; concrete commands are
   in [RECIPES.md](RECIPES.md). Record the exact Docker context, workspace,
   database, volume, cache, or VM image involved.
2. Check current processes, ownership, configured storage, service references,
   and a usable backup where data could matter. A large size or old timestamp
   alone does not make something disposable.
3. Explain the exact target, expected space reclaimed, and service or rollback
   impact. A broad request to audit does not authorize cleanup; follow the
   user's stated scope for cleanup actions and clarify only when that scope is
   ambiguous.
4. Use confirmation prompts where available and review proposed removals. Do
   not skip prompts with `--force`, combine unrelated cleanup targets, or
   include volumes in a broad prune.
5. Measure the same paths again and check service, container, and workspace
   state. Report measured recovery separately from estimates.

## Guardrails

- Protect databases, backup repositories, iCloud data, VM disks, JJ workspaces,
  Codex sessions and memories, authenticated browser state, and active app data
  until their owner and recovery path are understood.
- PostgreSQL statistics only cover counters since reset, and activity views
  show current connections. Neither proves a database is unused; file mtimes
  are not a reliable last-use signal.
- Confirm the Docker context before inspection or pruning. `system prune` can
  remove stopped containers, unused networks, dangling images, and build
  cache. `--all` broadens image removal; `--volumes` can remove data volumes.
- OrbStack restarts interrupt local containers. State that impact and get
  authorization before restarting it. Do not use a privileged helper container
  as a generic disk-inspection or trim command.
- Treat Nix generations as rollback points. Do not run garbage collection or
  remove generations automatically as routine maintenance.
- Prefer an available Nix-backed one-shot tool for diagnostics; do not install
  cleanup tools globally just to inspect a disk.
