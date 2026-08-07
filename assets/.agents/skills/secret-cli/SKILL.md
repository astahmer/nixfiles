---
name: secret-cli
description: Use the global `secret` command for scoped Bitwarden access: auth status, alias listing, exact value reads, hidden vault writes, and project dotenv generation. Use for credentials, API keys, or `.env` files in any repository.
---

# secret CLI

The global `secret` command wraps the official Bitwarden CLI (`bw`) with
config-driven, scoped access. It never enumerates the vault, never prints
values unless explicitly requested, and never stores `BW_SESSION`.

## Commands

- `secret status` — auth state plus the exact next command; `--check` exits nonzero when not unlocked.
- `secret unlock` — unlock and print a session token; `--store` persists it (macOS login keychain, plaintext file fallback elsewhere); the shell function exports `BW_SESSION` for the current shell.
- `secret lock` — lock the vault and clear any stored session.
- `secret list` — configured aliases from merged configs; aligned table on a TTY with creation dates when unlocked, TSV when piped; never touches the vault when piped.
- `secret search <term>` — find aliases by alias, item, or env key across scopes; no values, no vault access.
- `secret get <alias>` — print one configured value (or `--copy` to the clipboard), only when a value is explicitly required.
- `secret set <alias>` — hidden prompt, then write the value; `--generate` creates a random password; `--name`, `--source`, `--tags`, `--type`, and `--field` set item metadata; confirm or `--force` before overwriting.
- `secret edit <alias>` — update the Bitwarden item name, value, field, source, notes, custom fields, or local alias tags; `--tags ''` clears tags and `--force` skips overwrite confirmation.
- `secret source <alias> [url]` — print or update the source URL attached to an item.
- `secret id <alias>` — print the resolved Bitwarden item id without the value; use ids in configs when names can collide.
- `secret pin <alias>` — replace the item name with the resolved id in the project/local/user config that owns it.
- `secret rotate <alias>` — generate a new password and overwrite the item; confirm unless `--force`/`-f`; delivers the new value (clipboard, stdout fallback).
- `secret rm <alias>` — delete the vault item; confirm unless `--force`/`-f`; the config entry stays.
- `secret unset <alias>` — remove an alias from the project/local/user config that owns it.
- `secret mv <alias> <new>` — rename an alias in the project/user config, base and env overrides.
- `secret totp <alias>` — current 2FA code (`--copy` to the clipboard).
- `secret pull` — refresh the local vault cache from the server explicitly; never automatic (`sync`/`sy` still work).
- `secret init [alias...]` — scaffold a project `.secret.json` (directory name + kebab alias as item prefix); pass aliases to prefill; refuses to overwrite without `--force`.
- `secret print [project|global|nix]` — show every alias in one scope (alias, env, item, field, dotenv key); `--all` merges scopes with a scope column; never values, no vault access.
- `secret env --output .env` — generate a project dotenv atomically with mode 0600; `--export` prints `export KEY='value'` lines, `--diff` dry-runs without writing.
- `secret run -- <cmd>` — inject project aliases into a command's environment and run it, propagating its exit code; strict by default (any unresolvable alias aborts), `--optional A,B` opts out.
- `secret lint` — validate configs offline (items, env keys, dotenv-key collisions); no vault access, works locked; `--json` supported.
- `secret doctor` — validate configs, Bitwarden state, and alias resolvability without printing values.
- `secret doctor --json` — emit value-free per-alias diagnostics and remote metadata for machine consumers such as SecretBar.
- `secret recent` / `secret history` — recently used aliases and recent commands from a value-free local log.
- `secret prune [--dry-run]` — list or remove configured aliases whose remote items no longer exist.

Every command has a short alias (`st`, `ls`, `g`, `s`, `i`, `t`, `sy`, `p`,
`r`, `in`, `e`, `pr`, `d`, `re`, `h`); `secret g github-token` equals `secret
get github-token`. `secret list --json` and `secret print --json` emit
machine-readable rows on stdout for scripts.

`secret lint` runs before `secret doctor` in a workflow: lint is offline and
CI-friendly, doctor needs an unlocked vault. Use `secret lint --json` in
pre-commit checks.

## Config

- `~/.config/secret/config.json` — personal global aliases (optional).
- `./.secret.json` — project aliases (discovered from the current directory upward); commit it because it is value-free.
- `./.secret.local.json` — machine-local overrides, gitignored, merged last.
- `"environments"` in any config — per-env overrides selected with `--env` (default `prod`).

Precedence: user, then project, then local. The nixfiles repo itself declares
its machine-wide aliases in its root `.secret.json`; a project adds aliases
with its own `.secret.json` and local overrides with a gitignored
`.secret.local.json`.

Common flows: `secret env --env dev --output .env.dev` for a per-env dotenv,
and `secret env --required A,B --output .env` to fail fast when a required
alias is missing from the project config.

For item modeling, use `type: "login"` for one-line credentials such as
passwords, API keys, tokens, and usernames. Use `type: "secure-note"` with
`field: "notes"` for multiline sensitive material such as SSH keys, recovery
codes, certificates, or private documents. Login `notes` are optional item
metadata; Secure Note `notes` are the encrypted secret value. `custom:<name>`
is for a named Bitwarden custom field, not a replacement for the main value.
Tags are value-free local labels used for filtering and organization; they are
not Bitwarden item fields.

SecretBar is the native macOS menu-bar client. It hides aliases whose remote
items are missing, copies through the CLI clipboard path, supports Login and
Secure Note creation/editing, tag autocomplete, source/TOTP actions, expiry
health, pinned/recent filters, and keyboard-first navigation. Copy is the
default one-click action; rotation and destructive actions remain confirmed.
Its UI must never print or retain secret values except for an explicit,
hold-to-reveal interaction.

zsh and bash complete command words and then aliases for
`get`/`set`/`edit`/`source`/`id`/`totp`/`pin`/`rotate`/`rm` lazily with a
shared 60-second cache; neither runs at shell startup.

## Safety

- Never print, log, or commit secret values or `BW_SESSION`.
- Treat the stored session (keychain or file) like a credential; `secret lock` clears it.
- Pass values to `set` only via the hidden prompt, stdin, or `--generate`; never as an argument.
- Overwriting an existing item always confirms first unless `--force`/`-f` is passed.
- Prefer Bitwarden item IDs over names in configs when names can collide.
- When a task needs an app's secrets, generate its `.env` with
  `secret env --output .env` and keep `.env` gitignored.
