---
name: disk-space-cleanup
description: Audit macOS disk usage and reclaim space safely — Docker/OrbStack VMs, postgres volumes, node_modules, caches. Use when the user asks to free disk space, clean up disk, find large files, or when available space is critically low.
---

# Disk Space Cleanup (macOS)

Audit first, then delete only what is confirmed stale. Always report a table of
findings with sizes and let the user confirm anything risky before deleting.

## 1. Audit

Run these and rank findings by size:

```bash
df -h /                                  # overall pressure
du -sh ~/Library/Caches/* | sort -rh | head -20
find ~/dev -maxdepth 3 -name node_modules -type d -prune | xargs du -sk | sort -rn | head   # sum with awk for total
docker --context <ctx> system df          # PER CONTEXT: orbstack vs remote hosts (e.g. homeinfra-vps)
du -sh ~/Library/Group\ Containers/HUAQ24HBR6.dev.orbstack   # OrbStack VM disk (host side)
```

Typical safe-to-clean categories:

| Category | Command / path |
|---|---|
| Docker build cache + dangling images | `docker --context <ctx> builder prune -af && docker --context <ctx> image prune -af` |
| pnpm store | `pnpm store prune` |
| Old playwright browsers (`ms-playwright/chromium-<old>`, `chromium_headless_shell-<old>`) | keep only the newest version dirs; also check duplicate `ms-playwright-mcp` cache |
| Updater caches (`*-updater`) | `rm -rf ~/Library/Caches/*-updater` — always safe |
| node_modules in stale jj workspaces / merged clones | delete; reinstall is cheap via pnpm store |

## 2. Docker volumes & databases

Before dropping any database, prove it is unused. `pg_stat_database` has no
last-use timestamp — use file mtimes inside the data dir instead:

```bash
# last write per database (proxy for last use)
for d in $(psql -U <user> -d <db> -At -c "SELECT oid FROM pg_database"); do
  name=$(psql -U <user> -d <db> -Atc "SELECT datname FROM pg_database WHERE oid=$d")
  echo "$name -> $(find $PGDATA/base/$d -type f -printf '%T@\n' | sort -rn | head -1 \
    | awk '{print strftime(\"%Y-%m-%d %H:%M\", $1)}')"
done
```

Rules:
- Ask the user for an age threshold (default: untouched > 4 days = droppable).
- `DROP DATABASE "name-with-hyphens";` — quote identifiers with hyphens.
- Cross-check code history before deleting containers/images: search the repo
  (`rg -l -i <name> -g '!node_modules'` + `git log --grep`) to confirm a service
  is really retired, not just dormant.

## 3. OrbStack btrfs gotcha (CRITICAL)

OrbStack's VM disk is btrfs on a sparse host file at
`~/Library/Group Containers/HUAQ24HBR6.dev.orbstack/data/data.img.raw`.

After big deletes (dropped DBs, pruned images/volumes), the guest filesystem
**keeps reporting the freed extents as used** — even a full
`btrfs balance start -d` rewrites every chunk without reclaiming them.

Fix — restart the VM, then TRIM:

```bash
orb stop && sleep 3 && orb start
docker --context orbstack run --rm --privileged debian:stable-slim sh -c \
  'apt-get update -qq && apt-get install -y -qq btrfs-progs >/dev/null && fstrim -v /var/lib/docker'
du -sh ~/Library/Group\ Containers/HUAQ24HBR6.dev.orbstack/data/data.img.raw   # host-side truth
```

Only after the restart does `du` of the host-side sparse file shrink. Warn the
user first: restarting stops all local containers briefly (they come back via
restart policy; ones exited before may need `docker start`).

## 4. Verify & report

After cleanup, show before/after:

```bash
df -h /            # host free space
du -sh <cleaned paths>
docker --context <ctx> ps   # everything still running?
```
