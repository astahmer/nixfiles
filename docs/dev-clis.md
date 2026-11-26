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

## Completions

`<name>-update` writes the output of `<name> <completions…>` to
`~/.local/state/dev-clis/zsh/_<name>`. zsh registers it with an absolute
`autoload` plus `compdef` after `compinit`, so shell startup spawns nothing and
the `compinit -C` dump stays valid. Open a new shell after the first update.

## Tests

`assets/dev-clis/test-launcher.sh` (run by `nixcheck`) drives the launcher
against a fake checkout and fnm tree: exact version, same-major fallback, a
missing major, missing dependencies, the checkout override and shebang flags.
