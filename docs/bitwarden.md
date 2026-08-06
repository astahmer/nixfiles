# Bitwarden and the `secret` command

Bitwarden Password Manager remains the source of truth. The profile installs
`bw`, Bitwarden Desktop, optional agent-backed `rbw`, and a small global
`secret` command for scoped retrieval.

`secret` is a native Swift binary (`packages/secret`, v2) — no runtime
dependencies beyond `bw` itself. It replaces the original bun/TypeScript
runner (`assets/bitwarden/secret.ts`, still the reference spec and runnable
with `SECRET_IMPL=ts` in the test suite). macOS biometric unlock goes through
the bundled `secret-unlock-helper` (Touch ID-gated keychain read); a future
passkey unlock can be built on the Bitwarden SDK's C FFI without changing the
CLI surface.

## Login

```sh
bw config server https://vault.bitwarden.eu
bw login
export BW_SESSION="$(bw unlock --raw)"
```

`bw` is stateless across processes, so a plain session needs that export in
every shell. With the deployed shell integration, `secret unlock` does it for
you once per shell (it exports `BW_SESSION` in the current shell). For a
Doppler-style persistent login, `secret unlock --store` saves the session token
in the macOS login keychain (or a `~/.config/secret/session` file, mode 0600,
elsewhere); every later `secret` command works without exporting until
`secret lock` clears it. Treat the stored token like a credential — it grants
full vault access while valid. `secret status` warns when a stored session is
stale.

Passkeys: the Bitwarden web and desktop apps support passkey login, but the
official `bw` CLI still requires the master password (plus 2FA when enabled).
The stored session keeps that prompt rare.

`rbw` is convenient for interactive lookups because its agent holds unlocked
state in memory. `secret` uses the official `bw` CLI and the current
`BW_SESSION`; it never stores or exports that session.

## Config layers

Aliases come from three places, later wins:

- `~/.config/secret/config.json` — personal global aliases (optional).
- `./.secret.json` — project aliases, discovered from the current directory
  upward; commit it because it is value-free. The nixfiles repo itself carries
  one at its root for its machine-wide aliases.
- `./.secret.local.json` — machine-local overrides, same shape, gitignored;
  discovered upward like `.secret.json` and merged last.

Values are never committed. Inspect configured aliases without touching the
vault:

```sh
secret list
secret status
secret lint
secret doctor
secret recent
secret history
```

`secret status` prints the current auth state and the exact next command to
run: `bw login` when unauthenticated, `bw unlock` when locked, or the next
`secret` step when ready. `secret lint` validates every config offline — item
references, dotenv keys, and dotenv-key collisions across scopes (two different
aliases mapping to the same key overwrite each other silently in `.env`; the
same alias overriding another scope is fine). It never touches the vault, so it
works locked or unauthenticated and is CI-friendly. `secret doctor` validates
configs, Bitwarden state, and every alias against the vault without printing
values. `secret recent` and `secret history` show recently used aliases and
recent commands from a value-free local log.

`secret list` prints an aligned table in a terminal, including the vault item
creation date when the vault is unlocked (`-` when locked or the item is
missing). Bitwarden does not record which device or machine added an item, so
that source is not shown. Piped output stays tab-separated (alias, item, field)
so scripts and the shell completion cache parse it unchanged.

Retrieve exactly one configured value:

```sh
secret get github-token
secret get github-token --copy
secret id github-token
secret pin github-token
secret rotate github-token
secret rm github-token
secret totp github-token --copy
secret pull
secret status --check
```

Aliases are curated like jj: main commands keep a short form (`st`, `ls`,
`g`, `s`, `e`, `d`, `pr`, `pu`, `so`), plus `add` = set and
`delete`/`remove` = rm, and `sync` = pull (matching `bw sync`). So
`secret g github-token` is the same as `secret get github-token`.

`--copy` puts the value on the clipboard instead of stdout.
`secret id` prints the resolved Bitwarden item id without the value; use ids
in configs when two vault items could share a name. `secret pin` automates
that: it replaces the item name with the resolved id in the project or user
config (base mapping and environment overrides), atomically, and refuses the
aliases that are not in your own configs. `secret rotate` generates a new password and
overwrites the item (confirms first unless `--force`/`-f`), then copies the new
value to the clipboard (or prints it when no clipboard tool exists). `secret
rm` deletes the vault item (also confirms unless `--force`) and keeps the
config entry, so remove the alias from `.secret.json` by hand once the item is
gone. `secret totp` prints the current 2FA code for an item that carries a TOTP
seed. `secret pull` refreshes the local vault cache from the server explicitly
— never automatic (`sync` and `sy` still work as aliases).
`secret status --check` exits nonzero when the vault is not unlocked, for
scripts.

`secret history --json` and `secret recent --json` print the same information
as JSON rows for scripts.

`zsh` and `bash` complete a `secret` command word first, then aliases for
`get`/`set`/`id`/`totp`/`pin`/`rotate`/`rm`. The completion is lazy and cached
for 60 seconds, so shell startup is unaffected.

## Project setup

Scaffold a project `.secret.json` without writing JSON by hand:

```sh
secret init
```

`secret init` writes `.secret.json` in the current directory with one `EXAMPLE`
alias whose item prefix is the directory name (`myapp/example` from a `myapp/`
directory), so only the names need editing. It refuses to overwrite an existing
file unless `--force`/`-f` is given.

Pass aliases to prefill the scaffold instead:

```sh
secret init GITHUB_TOKEN STRIPE_KEY
```

Each alias becomes an item named after the directory plus the kebab-cased alias
(`myapp/github-token`), `field` defaulting to `password`. Names are validated,
so `secret init` never writes a config that `secret env` would reject later.

See everything a scope resolves without touching the vault:

```sh
secret print          # project scope (.secret.json found upward), incl. env overrides
secret print global   # ~/.config/secret/config.json
secret print local    # .secret.local.json (local overrides)
```

`secret print [project|global|local]` prints one line per alias — alias, env
(`prod` for the base mapping, or the override name), item, field, and dotenv
key — sorted for stable diffing. Values are never shown and no vault access
happens, so it is safe anywhere. Missing files and unknown scopes explain the
next step.

`secret list --json` and `secret print --json` print the same information as
JSON rows on stdout (stderr keeps the human summary), for scripts and for
feeding the completion cache.

`secret print --all` merges project, global, and local into one view with
a scope column — useful for audits: find where an alias lives or spot
duplicates. `secret search <term>` does the same across scopes, matching
alias, item, and dotenv key case-insensitively, never values; `--json` works
on both.

## Writing secrets

Write or rotate a configured value without exposing it in the shell:

```sh
secret set github-token
secret set STRIPE_KEY --generate
```

`secret set` prompts on the terminal with echo disabled (or reads a piped
value), never prints the value, and creates the vault item when it does not
exist yet. Overwriting an existing item asks for confirmation (showing its
creation date); pass `--force`/`-f` to skip. Values are accepted only from the
prompt, stdin, or `--generate`; never pass one as an argument. Prefer item IDs
over names in configs when two vault items could share a name.

`secret set --generate` creates a random password and delivers it like
`secret rotate`: copied to the clipboard, or printed when no clipboard tool
exists.

Remove or rename an alias in your own configs without hand-editing JSON:

```sh
secret unset DATABASE_URL
secret mv DATABASE_URL DB_URL
```

`unset` deletes the alias from the project or user config (base mapping and
environment overrides); `mv` renames it in place, rejecting invalid or already
taken names. Both refuse aliases that are not in your own configs.

## Project `.env` files

Any app repository can add a value-free `.secret.json`:

```json
{
  "secrets": {
    "DATABASE_URL": { "item": "myapp/database-url", "field": "password" },
    "STRIPE_KEY": { "item": "myapp/stripe-key", "field": "password" }
  }
}
```

Machine-local overrides go in a gitignored `.secret.local.json` next to the
project config — same shape, merged last. Override an item reference (for
example a machine-specific test vault) or add aliases that only exist on this
machine without touching the committed file.

Then generate only those declared values:

```sh
secret env --output .env
```

Environments override the base (prod) mappings with per-env items:

```json
{
  "secrets": {
    "DATABASE_URL": { "item": "myapp/database-url", "field": "password" }
  },
  "environments": {
    "dev": {
      "secrets": {
        "DATABASE_URL": { "item": "myapp/database-url-dev", "field": "password" }
      }
    }
  }
}
```

```sh
secret env --env dev --output .env.dev
secret env --required DATABASE_URL,STRIPE_KEY --output .env
secret env --export --output exports.sh
secret env --diff --output .env
secret run -- npm test
secret run --optional STRIPE_KEY -- npm test
```

`--env` defaults to `prod`; unknown environments are rejected. `--required`
fails unless every listed alias is present in the selected project config.
`--export` prints `export KEY='value'` lines (or writes them atomically with
`--output`) for sourcing instead of dotenv format. `--diff` resolves every
value, prints `+`/`-` lines against the target (default `./.env`), and writes
nothing — a dry run for rotation checklists. `secret run -- <command>` loads
the project aliases into the command's environment and runs it, propagating
its exit code — use `--` so the command's own flags are not parsed by
`secret`. `run` is strict by default: every declared alias must resolve, or
the command never runs. `--optional A,B` opts out — those aliases are skipped
with a warning when undeclared or unresolvable. `env --optional A,B` does the
same for dotenv generation.

Use `--config path/to/secrets.json` for another config. Existing `.env` files
are replaced atomically only after every requested value succeeds and are
written mode `0600`. `.secret.json` is discovered from the current directory
upward to `$HOME`, so subdirectories of a project work too. `secret` never
synchronizes the whole vault; reads go through the `bw serve` daemon when it
is running (see Daemon mode below) and otherwise fall back to one `bw list
items` spawn per command, since each `bw` spawn costs 1-2s+ of CLI startup.

## Daemon mode (sub-second reads)

Reads (`status`, `list`, `get`, `env`, `run`, `doctor`, `pin`) go through a
persistent `bw serve` daemon when available: a local HTTP server over a unix
socket in `~/.config/secret/daemon/` (directory mode 0700, state file mode
0600), origin protection left on. The daemon is started on first use
(~2s, one-time), then commands cost ~30-100ms instead of one 1-2s+ `bw` spawn
each.

- The daemon is restarted after any mutation (`set`, `rotate`, `rm`, `pull`,
  `unlock`, `lock`), so it never serves items changed outside it.
- The daemon only runs while the vault is unlocked; a locked vault falls back
  to per-command `bw` spawns, so a stale locked daemon can never answer auth
  checks with outdated state.
- Mutations ride the daemon too while it is up: `set`, `rotate`, `rm`, `pull`,
  and `--generate` use the serve REST API and keep the daemon warm; spawns are
  the fallback. `totp` always spawns (no serve route).
- `secret lock` kills the daemon; a stale daemon (dead process, expired
  session) is detected on the next command and replaced automatically.
- Disable it entirely with `SECRET_DAEMON=0`; nothing else changes.
- `bw serve` in current Bitwarden CLI versions has no API token, so binding
  matters: the unix socket inside a 0700 directory is what keeps other local
  users out. Do not point it at a TCP hostname.

## Limits and caveats

- The native binary starts in ~10ms; every `bw` spawn still costs 0.3-2s of
  CLI startup, so batching (one `bw list items` per command) and the daemon
  exist to avoid them. Mutations (`set`, `rotate`, `rm`, `totp`, `pull`)
  still spawn `bw` or ride the daemon — they are rare enough that it does
  not matter.
- `bw serve` can start with an empty vault cache: `secret` syncs once after
  starting the daemon and cross-checks an empty daemon item list against a
  spawn before trusting it.
- The daemon serves from memory; changes made outside `secret` (desktop app,
  web vault, another machine) are not visible until `secret pull` (restarts
  the daemon) or the next mutation.
- If `bw status` says unlocked but `get`/`list` fail or return nothing, the
  session/cache is stale: run `secret lock`, `secret unlock`, then
  `secret pull`.
- `secret unlock` needs a real terminal (the master-password prompt) and
  refuses to store an empty token. `--store` persists to the macOS keychain
  (or `~/.config/secret/session` elsewhere); the wrapper reads both.
- `secret unlock` reuses a session already present in the environment (for
  example the one `bw login` prints), so the master password is typed once:
  `export BW_SESSION="<login session>" && secret unlock --store`. A present
  but rejected session is refused instead of stored.
- Touch ID unlock (macOS): `secret-unlock-helper` caches the session behind a
  biometric prompt. `secret unlock --store` writes it automatically;
  `secret unlock --helper` reads it with Touch ID instead of asking for the
  master password again.
- Diagnostics go to stderr (so `secret get X | pbcopy` stays clean); terminals
  often render stderr in red, which is a display choice, not the CLI's.
- On a real terminal the CLI colors its own output with plain ANSI (no
  dependency): info hints are dim, successes green, warnings yellow, errors
  red, and the `list` header is bold cyan. Pipes and scripts get plain text.
- `secret list` shows local `CREATED AT` timestamps (date + hour:minute), and
  overwrite prompts use the same format.
- `-h`/`--help` after any command shows the global help; `env` dry runs are
  `--diff` (aliases `--dry`, `--dry-run`).
- `secret <command> -h` (or `secret help <command>`) shows that command's own
  usage and flags; bare `secret -h` shows the global help.
- `env`/`run` are strict by default: unresolved aliases fail with a hint to
  pass `--optional <alias1,alias2,...>` (all missing aliases are listed).
  Skipping silently by default would drop secrets from `.env` files without
  anyone noticing.
- The `field` in a config entry can be `password` (default), `username`,
  `notes`, or `custom:<name>` — for example `custom:source` for the URL a
  secret came from. `secret source <alias>` prints it, `secret source <alias>
  <url>` sets it, and `secret set --source URL` attaches it at creation.
- `secret set` with an unknown alias (or no alias at all, on a TTY) adds the
  alias to the project config — item named after the config directory, env
  key derived as `ALIAS_NAME` — then creates the vault item. `secret rm`
  falls back to unsetting the alias when the vault is confirmed to not
  contain the item.
- Aliases are curated like jj: main commands keep a short form (`st`, `ls`,
  `g`, `s`, `e`, `d`, `pr`, `pu`, `so`), plus `add` = set and
  `delete`/`remove` = rm, and `sync` = pull (matching `bw sync`).
- The global scope (`~/.config/secret/config.json`) is merged into every
  project. `secret set --global/-g <alias>`, `secret unset --global <alias>`,
  `secret global` (same as `secret print global`), and the subcommands
  `secret global add|unset <alias>` manage it.
- `secret env` emits a `# source: <url>` comment above any variable whose
  vault item carries a source URL; `secret list` shows a SOURCE column on a
  TTY; `secret doctor` reports the daemon state (`daemon up/down/disabled`);
  `secret status` appends `(daemon up)` when the daemon is serving.
- `secret prune [--dry-run]` removes config aliases whose vault items no
  longer exist; `--dry-run` only lists them.
- A tiny detached keepalive (the binary re-spawning itself) pings the daemon
  every 10s so the first command after idle does not pay bw serve's idle-wake
  cost (measured ~1.2-1.6s without it, ~0.1-0.8s with it). It exits when the
  daemon dies.
- bw 2026.x couples each session key to a protected auto-unlock key, and a
  stale `BW_SESSION` in the environment during `unlock` corrupts that state
  (bw warns about this itself). `secret` therefore strips `BW_SESSION` from
  every unlock, and the shell function runs `env -u BW_SESSION bw unlock`.
  If the state is already corrupt, repair once with `bw logout && bw login`
  in a shell without `BW_SESSION`, then `secret unlock --store` again.
- An empty vault (`bw list items` → `[]`) means the configured items do not
  exist yet: create them with `secret set <alias>` (or check that `bw config`
  points at the right server/account).
- bw 2026.x expects base64-encoded item JSON for `create`/`edit`; `secret`
  encodes it automatically. Failed `bw` calls surface bw's own stderr (up to
  300 chars) instead of a generic "request failed".
- `SECRET_DAEMON=0` disables the daemon; batching still applies.
- zsh/bash completions complete commands and aliases from a cache refreshed
  on TAB (60s TTL). The completion deliberately uses `compadd` rather than
  `_describe`, which trips zsh's colon-modifier parser in this shell config.
  The functions live in `assets/bitwarden/secret-completion.{zsh,bash}` and are
  covered by `assets/bitwarden/test-completions.sh`.
- Values never leave the vault through logs or history; `secret history` and
  `secret recent` record aliases only.

## Regression tests

`assets/bitwarden/test-secret.sh` runs a self-contained fake-`bw` suite
(temp HOME, fake vault, no network, 169 assertions) against the Swift binary
by default; `SECRET_IMPL=ts bash assets/bitwarden/test-secret.sh` runs the
same suite against the TypeScript reference implementation. The daemon-mode
assertions use a real unix-socket HTTP fixture (`test-daemon.ts`). The suite
builds `packages/secret` with `swift build -c release` on first run.
`assets/bitwarden/tsconfig.json` typechecks `secret.ts` strictly (`bun run
typecheck` from `assets/bitwarden`, after one `bun install`).
`nixfiles-check` runs the suites when `bun`/`swift` are on `PATH`; the
typecheck is skipped with a hint until the dev deps are installed.

The nixfiles repo declares the same scoped model in its root `.secret.json`:

- `opencodex-opencode-go-api-key` maps to the OpenCodex dotenv variable.
- `github-token` maps to the raw GitHub token projection consumed by Executor.
- `gemini-api-key` maps to the `GEMINI_API_KEY` env var read by ModLens.

## Why not `sdk-sm`/`bws`?

`bitwarden/sdk-sm` and `bws` are for the separate Bitwarden Secrets Manager
product. They require organization machine-account/project credentials and
cannot read a personal free-tier Password Manager vault. Keep using `bw` here.

If the goal later becomes encrypted secrets committed to a repository, evaluate
SOPS with age separately; it solves a different problem than runtime `.env`
projection.
