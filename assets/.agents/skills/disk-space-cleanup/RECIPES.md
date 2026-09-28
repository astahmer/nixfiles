# Disk Cleanup Recipes

Use these as starting points. Replace example contexts and paths only after
checking which machine or service owns the data.

## Host, workspace, and cache audit

```bash
df -h /System/Volumes/Data
diskutil apfs list
df -h /
du -sh "$HOME"/Library/Caches/* 2>/dev/null | sort -rh | head -20
find "$HOME/dev" -maxdepth 3 -type d -name node_modules -prune -print0 | xargs -0 du -sh | sort -rh | head -30
jj workspace list
docker context ls
```

Reference clones and Codex session logs can also account for substantial user
storage. Rank their directories and individual session files before considering
cleanup:

```bash
du -h -d 2 "$HOME/.references" 2>/dev/null | sort -rh | head -30
du -ah -d 4 "$HOME/.codex/sessions" 2>/dev/null | sort -rh | head -30
```

Treat both as user data, not disposable caches. Check whether projects still
use a reference clone and whether session history has a retention or recovery
need before proposing removal.

For an exact candidate, inspect its processes before proposing removal:

```bash
lsof +D "/exact/path/to/candidate"
du -sh "/exact/path/to/candidate"
```

Updater caches and Playwright browser directories can be shared or contain
state needed by active applications. Find and measure exact candidates first;
do not delete every path matching a wildcard.

## Databases

Use the configured PostgreSQL connection, then inspect database sizes and
current connections. Keep credentials out of commands and output.

```bash
psql -X -v ON_ERROR_STOP=1 -d postgres -c '
  SELECT db.datname,
         pg_size_pretty(pg_database_size(db.datname)) AS size,
         stats.numbackends,
         stats.stats_reset
  FROM pg_database AS db
  JOIN pg_stat_database AS stats USING (datname)
  WHERE NOT db.datistemplate
  ORDER BY pg_database_size(db.datname) DESC;
'

psql -X -v ON_ERROR_STOP=1 -d postgres -c '
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
docker --context "$dockerContext" system df --verbose
docker --context "$dockerContext" ps --all --size
docker --context "$dockerContext" image ls
docker --context "$dockerContext" volume ls
```

Choose the smallest cleanup that fits the request. These commands keep the
interactive confirmation enabled:

```bash
# Build cache only.
docker --context "$dockerContext" builder prune

# Build cache older than a cutoff chosen for this cleanup.
docker --context "$dockerContext" builder prune --filter 'until=24h'

# Dangling images only.
docker --context "$dockerContext" image prune

# Broad cleanup of stopped containers, unused networks, dangling images,
# and build cache. Review Docker's confirmation summary before answering yes.
docker --context "$dockerContext" system prune
```

Choose an `until` cutoff for the task; do not treat age as proof that a
container or image is disposable. Use `--force` only after the user explicitly authorizes the exact broad cleanup
scope and daemon context. `system prune --all`
removes unused images beyond dangling ones. `system prune --volumes` prunes
anonymous volumes, and `volume prune --all` can also remove unused named
volumes. Inspect exact volume ownership, mounts, and backups before any volume
cleanup. Keep it separate from `system prune`.

For explicitly approved broad cleanup, these variants include unused images
or all unused build cache. Keep volumes out of this batch. Stopped containers
are removed by system prune, including their writable layers; unused images
and cache may need downloading or rebuilding later.

```bash
# Interactive broad cleanup first.
rtk docker --context "$dockerContext" system prune --all
rtk docker --context "$dockerContext" builder prune --all

# Noninteractive equivalent, only when this exact scope is authorized.
rtk docker --context "$dockerContext" system prune -af
rtk docker --context "$dockerContext" builder prune -af

# Separate Buildx builder: inspect the selected builder before pruning its cache.
rtk docker --context "$dockerContext" buildx ls
rtk docker --context "$dockerContext" buildx du
rtk docker --context "$dockerContext" buildx prune --all
```

System prune already covers the daemon's unused containers, networks, images,
and build cache. Do not run every prune command redundantly. Buildx builders
can have separate caches, including remote builders; inspect their endpoint
before cleanup. Never add `--volumes` to the broad command.

Docker documents the scope of [`system prune`](https://docs.docker.com/reference/cli/docker/system/prune/),
[`builder prune`](https://docs.docker.com/reference/cli/docker/builder/prune/),
and [the prune commands](https://docs.docker.com/engine/manage-resources/pruning/).

## OrbStack sparse disk

Measure the host-side image and compare it with Docker's object-level report.
Use the path discovered on this machine; do not assume the image's apparent
size is the amount of host storage it occupies.

```bash
find "$HOME/Library/Group Containers" -maxdepth 5 -name data.img.raw -print
du -sh "/exact/path/returned/above/data.img.raw"

dockerContext=orbstack
docker --context "$dockerContext" system df --verbose
docker --context "$dockerContext" ps --all --size
```

Restarting OrbStack interrupts local containers. Check their state and obtain
authorization before using these commands:

```bash
orb stop
orb start
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
pnpm store path
du -sh "/store/path/returned/above"
pnpm store prune
```

Check the Playwright cache against versions used by active repositories before
removing older browser directories:

```bash
du -sh "$HOME/Library/Caches/ms-playwright"
find "$HOME/Library/Caches/ms-playwright" -maxdepth 1 -mindepth 1 -type d -print
```

For a project `node_modules`, verify that its JJ workspace is retired and no
process is using the directory. Reinstalling dependencies is usually cheap;
losing uncommitted work in a live workspace is not.

```bash
jj workspace list
lsof +D "/exact/stale/workspace/node_modules"
du -sh "/exact/stale/workspace/node_modules"
```

Only after the exact path is confirmed, its workspace is retired, and removal
is authorized, remove that one dependency tree:

```bash
rm -rf "/exact/stale/workspace/node_modules"
```

## Verify

Measure the same host paths and daemon context before and after. Check service
health and workspace state for interruptions.

```bash
df -h /
du -sh "/exact/path/cleaned"
docker --context "$dockerContext" system df --verbose
docker --context "$dockerContext" ps --all --size
jj workspace list
```
