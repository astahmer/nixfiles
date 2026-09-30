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
docker --context "$dockerContext" system prune --all
docker --context "$dockerContext" builder prune --all

# Noninteractive equivalent, only when this exact scope is authorized.
docker --context "$dockerContext" system prune -af
docker --context "$dockerContext" builder prune -af

# Separate Buildx builder: inspect the selected builder before pruning its cache.
docker --context "$dockerContext" buildx ls
docker --context "$dockerContext" buildx du
docker --context "$dockerContext" buildx prune --all
```

System prune already covers the daemon's unused containers, networks, images,
and build cache. Do not run every prune command redundantly. Buildx builders
can have separate caches, including remote builders; inspect their endpoint
before cleanup. Never add `--volumes` to the broad command.

Docker documents the scope of [`system prune`](https://docs.docker.com/reference/cli/docker/system/prune/),
[`builder prune`](https://docs.docker.com/reference/cli/docker/builder/prune/),
and [the prune commands](https://docs.docker.com/engine/manage-resources/pruning/).

## Docker volumes

List unattached volumes, then inspect each exact candidate's labels and mount
point. No attached container does not prove that a database or backup is obsolete.
Check Compose definitions and the owner's recovery needs before deletion.

```bash
dockerContext=orbstack
docker --context "$dockerContext" system df --verbose
docker --context "$dockerContext" volume ls --filter dangling=true
docker --context "$dockerContext" volume inspect EXACT_VOLUME_NAME
docker --context "$dockerContext" ps --all --filter volume=EXACT_VOLUME_NAME

# After approving this exact volume, remove only it (without --force).
docker --context "$dockerContext" volume rm EXACT_VOLUME_NAME
```

For a reviewed batch, `docker --context "$dockerContext" volume prune`
removes unused anonymous volumes with confirmation. Adding `--all` includes
unused named volumes; use it only after reviewing every candidate. These are
real data deletions, not image/cache cleanup. Never infer permission to delete
volumes from approval for `system prune -af`.

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

### pnpm metadata, older stores, and shared virtual store

Inspect paths before cleanup. `store prune` operates on the current store and
does not imply that every older version directory was cleaned.

```bash
pnpm --version
pnpm store path
pnpm cache path
du -sh "$HOME/.local/share/pnpm/store/"*
du -sh "$HOME/.cache/pnpm"
pnpm store prune
pnpm cache delete '*'
```

The quoted glob is a package-name pattern for the metadata command, not a shell
filesystem glob. Clearing metadata or pruning packages requires future downloads.
The `dlx` cache is separate; inspect its exact directory under the path returned
by `pnpm cache path`, stop active dlx commands, then remove only that verified
cache directory if needed.

Older store directories may still serve older project-pinned pnpm versions.
Check project `packageManager` declarations, `.modules.yaml` store references,
and active installs before deleting one exact obsolete store. Do not point a
newer pnpm at an older version directory and assume it prunes that format.

```bash
rg -n '"packageManager"' "$HOME/dev" --glob package.json --glob '!node_modules/**'
rg -n 'storeDir:|virtualStoreDir:' /exact/project/node_modules/.modules.yaml
lsof +D "$HOME/.local/share/pnpm/store/v10"
# Only after confirming this exact versioned store is obsolete:
rm -rf "$HOME/.local/share/pnpm/store/v10"
```

pnpm's global virtual store was added in 10.12.1. It shares dependency-graph
layouts across projects, beyond sharing package files through the content store.
Try one project before a machine-wide setting; reinstalling is needed to change
existing project layouts. Do not remove its central `links` directory as a cache:
project node_modules can point into it.

```bash
pnpm config get enableGlobalVirtualStore
pnpm config get virtualStoreType
# Opt-in trial in one project using the spelling supported since 10.12.1:
env PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=true pnpm --dir /exact/project install --frozen-lockfile
rg -n 'storeDir:|virtualStoreDir:' /exact/project/node_modules/.modules.yaml
```

Since 11.23.0 the canonical spelling is `virtualStoreType: global`; the older
boolean remains supported. Configure a durable machine default through the
Nix-owned pnpm config, not `pnpm config set --global`. Dependency graphs with
different peers or dependencies still need separate entries. Test project tools
and direct Node/ESM launches: phantom dependencies can have different resolution
behavior. APFS clones and hardlinks also mean directory totals are not guaranteed
unique physical bytes.

References: https://pnpm.io/settings/node-modules and https://pnpm.io/cli/store.

### Bun package cache

```bash
bun pm cache
# After ensuring no Bun installs are running:
bun pm cache rm
```

This clears Bun's package download cache, not project source or global packages.
Use the returned path rather than assuming `~/.bun/install/cache`; this machine
may use an XDG cache path. Future installs download packages again.

### Nub store and metadata cache

Verify installed help; Nub 0.9.3 supports previews for both pruning operations.
Store pruning preserves project node_modules, manifests, and lockfiles.

```bash
nub store path
nub cache path
nub store prune --dry-run --json
nub cache prune --dry-run
# After reviewing the previews:
nub store prune
nub cache prune
# Optional: clear package metadata; '*' is a quoted package-name pattern.
nub cache delete '*'
```

`cache prune` removes stale extracted primer files (default age: 30 days), not
all metadata. `cache delete` clears matching package metadata. Avoid deleting
the entire Nub store manually: it can contain global virtual-store entries
referenced by projects.

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
