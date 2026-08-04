# Bitwarden and the `secret` command

Bitwarden Password Manager remains the source of truth. The profile installs
`bw`, Bitwarden Desktop, optional agent-backed `rbw`, and a small global
`secret` command for scoped retrieval.

## Login

```sh
bw config server https://vault.bitwarden.eu
bw login
export BW_SESSION="$(bw unlock --raw)"
```

`rbw` is convenient for interactive lookups because its agent holds unlocked
state in memory. `secret` uses the official `bw` CLI and the current
`BW_SESSION`; it never stores or exports that session.

## Nix defaults

Nix deploys public aliases to `~/.config/secret/defaults.json`. Values are
never committed. Inspect configured aliases without touching the vault:

```sh
secret list
secret status
secret doctor
secret recent
secret history
```

`secret status` prints the current auth state and the exact next command to
run: `bw login` when unauthenticated, `bw unlock` when locked, or the next
`secret` step when ready. `secret doctor` validates configs, Bitwarden state,
and every alias without printing values. `secret recent` and `secret history`
show recently used aliases and recent commands from a value-free local log.

Retrieve exactly one configured value:

```sh
secret get github-token
secret get github-token --copy
secret id github-token
secret pin github-token
secret rotate github-token
secret rm github-token
secret totp github-token --copy
secret sync
secret status --check
```

Every command has a short alias (`st`, `ls`, `g`, `s`, `i`, `t`, `sy`, `p`,
`in`, `e`, `pr`, `d`, `re`, `h`), so `secret g github-token` is the same as
`secret get github-token`.

`--copy` puts the value on the clipboard instead of stdout.
`secret id` prints the resolved Bitwarden item id without the value; use ids
in configs when two vault items could share a name. `secret pin` automates
that: it replaces the item name with the resolved id in the project or user
config (base mapping and environment overrides), atomically, and refuses the
Nix-managed `defaults.json`. `secret rotate` generates a new password and
overwrites the item (confirms first unless `--force`/`-f`), then copies the new
value to the clipboard (or prints it when no clipboard tool exists). `secret
rm` deletes the vault item (also confirms unless `--force`) and keeps the
config entry, so remove the alias from `.secret.json` by hand once the item is
gone. `secret totp` prints the current 2FA code for an item that carries a TOTP
seed. `secret sync` refreshes the cached vault explicitly — never automatic.
`secret status --check` exits nonzero when the vault is not unlocked, for
scripts.

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
secret print nix      # Nix-managed defaults.json
```

`secret print [project|global|nix]` prints one line per alias — alias, env
(`prod` for the base mapping, or the override name), item, field, and dotenv
key — sorted for stable diffing. Values are never shown and no vault access
happens, so it is safe anywhere. Missing files and unknown scopes explain the
next step.

`secret list --json` and `secret print --json` print the same information as
JSON rows on stdout (stderr keeps the human summary), for scripts and for
feeding the completion cache.

`secret print --all` merges project, global, and nix into one view with a scope
column — useful for audits: find where an alias lives, spot duplicates after a
`nixapply`, or diff your configs against the Nix-managed defaults. `secret
search <term>` does the same across scopes, matching alias, item, and dotenv
key case-insensitively, never values; `--json` works on both.

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
taken names. Both refuse aliases that only exist in the Nix-managed
`defaults.json` — copy those into your own config first.

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
```

`--env` defaults to `prod`; unknown environments are rejected. `--required`
fails unless every listed alias is present in the selected project config.
`--export` prints `export KEY='value'` lines (or writes them atomically with
`--output`) for sourcing instead of dotenv format. `--diff` resolves every
value, prints `+`/`-` lines against the target (default `./.env`), and writes
nothing — a dry run for rotation checklists.

Use `--config path/to/secrets.json` for another config. Existing `.env` files
are replaced atomically only after every requested value succeeds and are
written mode `0600`. `.secret.json` is discovered from the current directory
upward to `$HOME`, so subdirectories of a project work too. `secret` never
enumerates or synchronizes the whole vault.

## Regression tests

`assets/bitwarden/test-secret.sh` runs a self-contained fake-`bw` suite
(temp HOME, fake vault, no network); `nixfiles-check` runs it when `bun` is on
`PATH`.

The Nix-managed consumers use the same scoped model:

- `opencodex-opencode-go-api-key` maps to the OpenCodex dotenv variable.
- `github-token` maps to the raw GitHub token projection consumed by Executor.

## Why not `sdk-sm`/`bws`?

`bitwarden/sdk-sm` and `bws` are for the separate Bitwarden Secrets Manager
product. They require organization machine-account/project credentials and
cannot read a personal free-tier Password Manager vault. Keep using `bw` here.

If the goal later becomes encrypted secrets committed to a repository, evaluate
SOPS with age separately; it solves a different problem than runtime `.env`
projection.
