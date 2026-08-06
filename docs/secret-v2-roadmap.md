# secret v2 roadmap

Native Swift port shipped (daemon reads, keychain session, curated aliases).
This file tracks the approved follow-ups and the macOS menu bar idea. Items
marked *landed* are done; the rest are planned, not implemented.

## Approved (next batch)

1. **Fold `secret-unlock-helper` into the main binary** — *landed*: the
   helper package is deleted; `secret unlock --helper` and `--store`'s cache
   write now run in-process (`LAContext` + `SecItem`). A legacy helper binary
   on PATH still wins (test fixtures/old installs). A biometric ACL on the
   stored item remains future work (unsigned CLIs cannot create ACL items).
2. **LAContext for dangerous mutations** — *landed*: `secret rm` and
   `secret rotate` confirm with Touch ID on a terminal when biometrics are
   available; `[y/N]` remains the fallback (`SECRET_NO_BIOMETRICS=1`).
3. **Passkey unlock via the Bitwarden SDK C FFI** — *blocked upstream*
   (checked 2026-08-06): the `bw` CLI still has no passkey unlock (open
   community feature request), and the only public SDK is the Secrets
   Manager SDK, which authenticates with machine accounts, not a personal
   Password Manager vault. In-process vault access via the SDK would still
   be a large project worth doing later; re-evaluate when Bitwarden ships
   passkey/PIN unlock for the CLI or a Password Manager SDK.
4. **`secret source --open`** — *landed*: opens the stored source URL with
   `open`/`xdg-open`, or sets then opens when a url is given.

## Considered and rejected

- Auto-clearing clipboard after `--copy` — rejected: clearing the clipboard
  out from under the user is worse UX than leaving the value.
- Lock on screen lock (launchd agent watching `NSWorkspace`) — shelved: the
  delay between screen lock and agent reaction plus accidental lockouts make
  it feel worse than the security it adds for a personal vault.

## macOS menu bar app (v0.1 built)

Purpose: a small SwiftUI `MenuBarExtra` for the secret manager itself.
openusage.ai was design inspiration only (popover layout, status dot, cards)
— no AI-usage features. The app is a launcher for the deployed `secret`
binary (same session, keychain, daemon, configs, history) plus UI-native
capabilities the CLI does not have.

Shipped as `packages/secretbar` (SecretBar.app): status dot, fuzzy
cross-project search (indexes `~/dev/*/.secret.json` + global config),
click-to-copy, Touch ID unlock / master-password unlock in-app, lock,
recent re-copy from `history.json`, per-project health badges from
`secret doctor`, source-open and rotate actions, stored-session age. The
in-app TTL copy chip was explicitly dropped (user decision).

Core loop: menu bar dot (unlocked = green / locked = amber / health
problems = red) → click → fuzzy search box → click an alias = copy →
secondary actions. Touch ID unlock and lock are one click away, no terminal.
