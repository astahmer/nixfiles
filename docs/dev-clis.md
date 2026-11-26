# Local dev CLIs on PATH

The standard way to expose a CLI you develop locally (a Node/TypeScript entry in
a checkout) as a global command: no `npm -g`, no `pnpm link`, no rebuild after
an edit, the right Node version, any working directory.

`modules/dev-clis.nix` turns each `devClis.<name>` entry into two commands:

1. `<name>`: a small bash launcher (from `assets/dev-clis/`) that `exec`s the
   checkout's entry file with the checkout's Node. Arguments, stdin, the exit
   code and signals pass straight through.
2. `<name>-update`: moves the checkout to its tracked revision, reinstalls its
   dependencies and refreshes the cached zsh completion.

## Add a CLI

One attribute in the host wiring (`hosts/macbook/default.nix`), then `nixapply`:

```nix
devClis.foo = { checkout = "~/dev/foo"; entry = "src/cli.ts"; };
```

| Field         | Default | Meaning                                                                                 |
| ------------- | ------- | --------------------------------------------------------------------------------------- |
| `checkout`    | —       | Checkout the command runs; `~/` allowed.                                                |
| `entry`       | —       | Entry file relative to the checkout.                                                    |
| `repo`        | `null`  | jj repository `<name>-update` adds the checkout to as a workspace when it is missing.   |
| `track`       | `null`  | jj revset `<name>-update` fetches and moves the checkout onto, such as `main@origin`.   |
| `completions` | `[ ]`   | Arguments that print the zsh completion, such as `[ "completions" "zsh" ]`.             |
| `checkoutEnv` | `null`  | Variable that overrides the checkout per call; defaults to `<NAME>_CHECKOUT`.           |
| `build`       | `null`  | Command `<name>-update` runs in the checkout after installing, for a built entry.       |
| `bundle`      | `null`  | `{ entry; stamp; build; }`: a prebuilt entry run while its stamp names the checkout's commit. |

A built entry (a `dist/` file) works the same way: `devClis.dshx` in
`modules/dsh.nix` runs `tooling/dshx/packages/dshx/dist/cli/bin.js` from the
dshfiles checkout you work in, honors `DSHFILES_DIR`, and `dshx-update`
reinstalls and rebuilds it.

## What the launcher does

1. Picks the checkout: `<NAME>_CHECKOUT` (upper case, `-` → `_`) when set,
   otherwise `checkout`. `MAO_CHECKOUT=~/dev/maocode-threads/foo mao status`
   runs a thread workspace's build of `mao` without changing anything.
2. Fails with a hint (`run <name>-update`) when the entry or `node_modules` is
   missing, and warns when `pnpm-lock.yaml` is newer than the last install.
3. Resolves Node from the checkout's `.node-version` (or `.nvmrc`) straight from
   fnm's install tree, without starting `fnm`. A version fnm lacks falls back to
   the pinned `nodejs_24` when the major matches; another major fails with
   `fnm install <version>`.
4. Keeps the Node flags of a `#!/usr/bin/env -S node <flags>` shebang.
5. Exports `<NAME>_UPDATE_COMMAND=<name>-update`, so the CLI can tell users how
   this install updates.

6. With `repo` and a `bookmark@remote` `track`, prints one dim line at most
   once a day when the last fetched ref is ahead of the checkout
   (`mao: 16 new commit(s) on origin/main; run mao-update`). It reads the
   colocated repo's loose Git ref and the checkout's `HEAD` (no network, no jj),
   runs `git rev-list --count` once per new tip, and stays silent when stderr
   is not a terminal or the checkout is overridden. The stamp lives in
   `~/.local/state/dev-clis/<name>.behind`.

7. With `bundle`, runs `bundle.entry` instead of `entry` when the first line
   of `bundle.stamp` equals the checkout's Git `HEAD` commit, read from files
   only (the `.git` file → worktree gitdir → `HEAD`; a jj workspace keeps it
   detached at `@-`; a branch resolves through its loose ref). Anything else
   (no build, a failed build, a newer commit) runs the source silently.
   `<NAME>_SOURCE=1` forces the source. Only the configured checkout is
   trusted to carry no uncommitted edits, which `<name>-update` enforces: there
   is no per-call file walk (it costs 60–100 ms on maocode). A
   `<NAME>_CHECKOUT` override is a workspace you edit, so it always runs its
   source.
8. `DEV_CLIS_DEBUG=1` prints the file it runs (`mao: running …/dist/mao.mjs`)
   on stderr.

`PATH` is left alone: children of the CLI see the same `node` as your shell.

## Which checkout to follow

Point `checkout` at a **dedicated jj workspace nobody edits**, with `track`
set, rather than the checkout you work in:

1. The command stays at a known revision (`main@origin`), not at whatever the
   working workspace holds mid-edit or mid-rebase.
2. Its `node_modules` matches that revision, so switching branches elsewhere
   never breaks the global command.
3. Your working checkouts keep the fast loop: `node <entry>` (or
   `<NAME>_CHECKOUT=$PWD <name>`) runs your edits there.

`<name>-update` creates the workspace on first run (`jj workspace add` in
`repo`), then on later runs fetches, refuses if the workspace has changes, moves
it with `jj new <track>` only when the tracked revision moved, and runs
`pnpm install --frozen-lockfile` (or `npm ci`). It never rewrites history.
With `bundle`, it then deletes the stamp and runs `bundle.build`; a failure
prints one warning and leaves the CLI on its source, with the build output in
`~/.local/state/dev-clis/<name>-bundle.log`.

`devClis.mao` uses it: `node apps/cli/build.ts --no-binaries` writes
`apps/cli/dist/mao.mjs` and `apps/cli/dist/.source-commit` (gitignored, so jj
never snapshots them), and the bundle runs about 65 % fewer instructions than
the sources.

## Completions

`<name>-update` writes the output of `<name> <completions…>` to
`~/.local/state/dev-clis/zsh/_<name>`. zsh registers it with an absolute
`autoload` plus `compdef` after `compinit`, so shell startup spawns nothing and
the `compinit -C` dump stays valid. Open a new shell after the first update.

## Tests

`assets/dev-clis/test-launcher.sh` (run by `nixcheck`) drives the launcher
against a fake checkout and fnm tree: exact version, same-major fallback, a
missing major, missing dependencies, the checkout override, shebang flags, and
bundle selection (matching stamp, `<NAME>_SOURCE`, checkout override, newer
commit, branch `HEAD`, missing bundle).
