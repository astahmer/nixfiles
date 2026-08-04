---
name: secret-cli
description: Use the global `secret` command for scoped Bitwarden access: auth status, alias listing, exact value reads, hidden vault writes, and project dotenv generation. Use for credentials, API keys, or `.env` files in any repository.
---

# secret CLI

The global `secret` command wraps the official Bitwarden CLI (`bw`) with
config-driven, scoped access. It never enumerates the vault, never prints
values unless explicitly requested, and never stores `BW_SESSION`.

## Commands

- `secret status` — auth state plus the exact next command (login, unlock, or start).
- `secret list` — configured aliases from merged configs; never touches the vault.
- `secret get <alias>` — print one configured value, only when a value is explicitly required.
- `secret set <alias>` — hidden prompt, then write the value; `--generate` creates a random password.
- `secret env --output .env` — generate a project dotenv atomically with mode 0600.

## Config

- `~/.config/secret/defaults.json` — Nix-managed global aliases.
- `~/.config/secret/config.json` — personal global aliases.
- `./.secret.json` — project aliases; commit it because it is value-free.

Precedence: defaults, then user, then project. A project adds aliases with its
own `.secret.json`; it needs no nixfiles change.

## Safety

- Never print, log, or commit secret values or `BW_SESSION`.
- Pass values to `set` only via the hidden prompt, stdin, or `--generate`; never as an argument.
- Prefer Bitwarden item IDs over names in configs when names can collide.
- When a task needs an app's secrets, generate its `.env` with
  `secret env --output .env` and keep `.env` gitignored.
