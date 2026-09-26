# Disk Cleanup Recipes

Use these as starting points. Replace example contexts and paths only after
checking which machine or service owns the data.

## Host, workspace, and cache audit

```bash
rtk df -h /System/Volumes/Data
rtk diskutil apfs list
rtk df -h /
rtk du -sh "$HOME"/Library/Caches/* 2>/dev/null | sort -rh | head -20
rtk find "$HOME/dev" -maxdepth 3 -type d -name node_modules -prune -print0 | xargs -0 rtk du -sh | sort -rh | head -30
rtk jj workspace list
rtk docker context ls
```

Reference clones and Codex session logs can also account for substantial user
storage. Rank their directories and individual session files before considering
cleanup:

```bash
rtk du -h -d 2 "$HOME/.references" 2>/dev/null | sort -rh | head -30
rtk du -ah -d 4 "$HOME/.codex/sessions" 2>/dev/null | sort -rh | head -30
```

Treat both as user data, not disposable caches. Check whether projects still
use a reference clone and whether session history has a retention or recovery
need before proposing removal.

For an exact candidate, inspect its processes before proposing removal:

```bash
rtk lsof +D "/exact/path/to/candidate"
rtk du -sh "/exact/path/to/candidate"
```

Updater caches and Playwright browser directories can be shared or contain
state needed by active applications. Find and measure exact candidates first;
do not delete every path matching a wildcard.

## Databases

Use the configured PostgreSQL connection, then inspect database sizes and
current connections. Keep credentials out of commands and output.

```bash
rtk psql -X -v ON_ERROR_STOP=1 -d postgres -c '
  SELECT db.datname,
         pg_size_pretty(pg_database_size(db.datname)) AS size,
         stats.numbackends,
         stats.stats_reset
  FROM pg_database AS db
  JOIN pg_stat_database AS stats USING (datname)
  WHERE NOT db.datistemplate
  ORDER BY pg_database_size(db.datname) DESC;
'

rtk psql -X -v ON_ERROR_STOP=1 -d postgres -c '
  SELECT datname, usename, application_name, state, count(*) AS connections
  FROM pg_stat_activity
  WHERE datname IS NOT NULL AND pid <> pg_backend_pid()
  GROUP BY datname, usename, application_name, state
  ORDER BY datname, usename, application_name, state;
'
```

Statistics and connection counts cannot prove a database is unused. Check its
owner, configured data directory, service references, and a usable backup
before proposing a drop. Avoid filesystem-mtime scripts that label a database
as unused based on its last file write.

## Docker

Set the context to the daemon that owns the data. `orbstack` is an example;
remote hosts have separate images, containers, caches, and volumes.

```bash
dockerContext=orbstack
rtk docker --context "$dockerContext" system df --verbose
rtk docker --context "$dockerContext" ps --all --size
rtk docker --context "$dockerContext" image ls
rtk docker --context "$dockerContext" volume ls
```

Choose the smallest cleanup that fits the request. These commands keep the
interactive confirmation enabled:

```bash
# Build cache only.
rtk docker --context "$dockerContext" builder prune

# Build cache older than a cutoff chosen for this cleanup.
rtk docker --context "$dockerContext" builder prune --filter 'until=24h'

# Dangling images only.
rtk docker --context "$dockerContext" image prune

# Broad cleanup of stopped containers, unused networks, dangling images,
# and build cache. Review Docker's confirmation summary before answering yes.
rtk docker --context "$dockerContext" system prune
```

Choose an `until` cutoff for the task; do not treat age as proof that a
container or image is disposable. Do not add `--force`. `system prune --all`
removes unused images beyond dangling ones. `system prune --volumes` prunes
anonymous volumes, and `volume prune --all` can also remove unused named
volumes. Inspect exact volume ownership, mounts, and backups before any volume
cleanup. Keep it separate from `system prune`.

Docker documents the scope of [`system prune`](https://docs.docker.com/reference/cli/docker/system/prune/),
[`builder prune`](https://docs.docker.com/reference/cli/docker/builder/prune/),
and [the prune commands](https://docs.docker.com/engine/manage-resources/pruning/).

## OrbStack sparse disk

Measure the host-side image and compare it with Docker's object-level report.
Use the path discovered on this machine; do not assume the image's apparent
size is the amount of host storage it occupies.

```bash
rtk find "$HOME/Library/Group Containers" -maxdepth 5 -name data.img.raw -print
rtk du -sh "/exact/path/returned/above/data.img.raw"

dockerContext=orbstack
rtk docker --context "$dockerContext" system df --verbose
rtk docker --context "$dockerContext" ps --all --size
```

Restarting OrbStack interrupts local containers. Check their state and obtain
authorization before using these commands:

```bash
rtk orb stop
rtk orb start
```

The OrbStack CLI documents stop/start controls at [Command line & CI](https://docs.orbstack.dev/headless).
Do not copy the old privileged `fstrim` container command from session history:
it did not mount the VM's Docker data directory, so it could not establish that
it trimmed the target filesystem. No generic OrbStack trim command is
documented here; use the current OrbStack procedure for the installed version
and exact guest filesystem.

## Package stores and project workspaces

pnpm's store is shared. Check its location and ensure no install is running
before pruning; removed packages may need to be downloaded again.

```bash
rtk pnpm store path
rtk du -sh "/store/path/returned/above"
rtk pnpm store prune
```

Check the Playwright cache against versions used by active repositories before
removing older browser directories:

```bash
rtk du -sh "$HOME/Library/Caches/ms-playwright"
rtk find "$HOME/Library/Caches/ms-playwright" -maxdepth 1 -mindepth 1 -type d -print
```

For a project `node_modules`, verify that its JJ workspace is retired and no
process is using the directory. Reinstalling dependencies is usually cheap;
losing uncommitted work in a live workspace is not.

```bash
rtk jj workspace list
rtk lsof +D "/exact/stale/workspace/node_modules"
rtk du -sh "/exact/stale/workspace/node_modules"
```

Only after the exact path is confirmed, its workspace is retired, and removal
is authorized, remove that one dependency tree:

```bash
rtk rm -rf "/exact/stale/workspace/node_modules"
```

## Verify

Measure the same host paths and daemon context before and after. Check service
health and workspace state for interruptions.

```bash
rtk df -h /
rtk du -sh "/exact/path/cleaned"
rtk docker --context "$dockerContext" system df --verbose
rtk docker --context "$dockerContext" ps --all --size
rtk jj workspace list
```
