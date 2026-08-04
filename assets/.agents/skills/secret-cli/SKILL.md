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
- `secret get <alias>` — print one configured value (or `--copy` to the clipboard), only when a value is explicitly required.
- `secret set <alias>` — hidden prompt, then write the value; `--generate` creates a random password; confirm or `--force` before overwriting.
- `secret id <alias>` — print the resolved Bitwarden item id without the value; use ids in configs when names can collide.
- `secret totp <alias>` — current 2FA code (`--copy` to the clipboard).
- `secret sync` — refresh the cached vault explicitly; never automatic.
- `secret env --output .env` — generate a project dotenv atomically with mode 0600.
- `secret doctor` — validate configs, Bitwarden state, and alias resolvability without printing values.
- `secret recent` / `secret history` — recently used aliases and recent commands from a value-free local log.

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

zsh completes aliases for `get`/`set`/`id`/`totp` lazily with a 60-second
cache; it never runs at shell startup.

## Safety

- Never print, log, or commit secret values or `BW_SESSION`.
- Pass values to `set` only via the hidden prompt, stdin, or `--generate`; never as an argument.
- Overwriting an existing item always confirms first unless `--force`/`-f` is passed.
- Prefer Bitwarden item IDs over names in configs when names can collide.
- When a task needs an app's secrets, generate its `.env` with
  `secret env --output .env` and keep `.env` gitignored.
