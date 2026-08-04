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
- `secret list` — configured aliases from merged configs; never touches the vault.
- `secret search <term>` — find aliases by alias, item, or env key across scopes; no values, no vault access.
- `secret get <alias>` — print one configured value (or `--copy` to the clipboard), only when a value is explicitly required.
- `secret set <alias>` — hidden prompt, then write the value; `--generate` creates a random password; confirm or `--force` before overwriting.
- `secret id <alias>` — print the resolved Bitwarden item id without the value; use ids in configs when names can collide.
- `secret pin <alias>` — replace the item name with the resolved id in the project/user config (never the Nix-managed defaults).
- `secret rotate <alias>` — generate a new password and overwrite the item; confirm unless `--force`/`-f`; delivers the new value (clipboard, stdout fallback).
- `secret rm <alias>` — delete the vault item; confirm unless `--force`/`-f`; the config entry stays.
- `secret unset <alias>` — remove an alias from the project/user config (never the Nix-managed defaults).
- `secret mv <alias> <new>` — rename an alias in the project/user config, base and env overrides.
- `secret totp <alias>` — current 2FA code (`--copy` to the clipboard).
- `secret sync` — refresh the cached vault explicitly; never automatic.
- `secret init [alias...]` — scaffold a project `.secret.json` (directory name + kebab alias as item prefix); pass aliases to prefill; refuses to overwrite without `--force`.
- `secret print [project|global|nix]` — show every alias in one scope (alias, env, item, field, dotenv key); `--all` merges scopes with a scope column; never values, no vault access.
- `secret env --output .env` — generate a project dotenv atomically with mode 0600; `--export` prints `export KEY='value'` lines, `--diff` dry-runs without writing.
- `secret lint` — validate configs offline (items, env keys, dotenv-key collisions); no vault access, works locked; `--json` supported.
- `secret doctor` — validate configs, Bitwarden state, and alias resolvability without printing values.
- `secret recent` / `secret history` — recently used aliases and recent commands from a value-free local log.

Every command has a short alias (`st`, `ls`, `g`, `s`, `i`, `t`, `sy`, `p`,
`r`, `in`, `e`, `pr`, `d`, `re`, `h`); `secret g github-token` equals `secret
get github-token`. `secret list --json` and `secret print --json` emit
machine-readable rows on stdout for scripts.

`secret lint` runs before `secret doctor` in a workflow: lint is offline and
CI-friendly, doctor needs an unlocked vault. Use `secret lint --json` in
pre-commit checks.

## Config

- `~/.config/secret/defaults.json` — Nix-managed global aliases.
- `~/.config/secret/config.json` — personal global aliases.
- `./.secret.json` — project aliases (discovered from the current directory upward); commit it because it is value-free.
- `"environments"` in any config — per-env overrides selected with `--env` (default `prod`).

Precedence: defaults, then user, then project. A project adds aliases with its
own `.secret.json`; it needs no nixfiles change.

Common flows: `secret env --env dev --output .env.dev` for a per-env dotenv,
and `secret env --required A,B --output .env` to fail fast when a required
alias is missing from the project config.

zsh and bash complete command words and then aliases for
`get`/`set`/`id`/`totp`/`pin`/`rotate`/`rm` lazily with a shared 60-second
cache; neither runs at shell startup.

## Safety

- Never print, log, or commit secret values or `BW_SESSION`.
- Pass values to `set` only via the hidden prompt, stdin, or `--generate`; never as an argument.
- Overwriting an existing item always confirms first unless `--force`/`-f` is passed.
- Prefer Bitwarden item IDs over names in configs when names can collide.
- When a task needs an app's secrets, generate its `.env` with
  `secret env --output .env` and keep `.env` gitignored.
