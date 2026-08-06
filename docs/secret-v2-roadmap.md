# secret v2 roadmap

Native Swift port shipped (daemon reads, keychain session, curated aliases).
This file tracks the approved follow-ups and the macOS menu bar idea. Items
marked *landed* are done; the rest are planned, not implemented.

## Approved (next batch)

1. **Fold `secret-unlock-helper` into the main binary** — talk to Keychain
   Services directly (`SecItem`) instead of spawning `security`, and store
   the session behind a biometric ACL (Touch ID-gated *storage*, not just
   Touch ID-gated read — the varlock idea). `secret unlock --helper` becomes
   in-process `LAContext`; the separate package, its wrapper, and the
   PATH-based fake in the suite go away.
2. **LAContext for dangerous mutations** — `secret rm` (and optionally
   `rotate`) confirm with Touch ID on a terminal when a biometric session
   exists, instead of a plain `[y/N]`.
3. **Passkey unlock via the Bitwarden SDK C FFI** — the big one. In-process
   vault access would make `bw` spawns and even the daemon obsolete for
   reads. Evaluate SDK bindings first; keep the current CLI surface stable.
4. **`secret source --open`** — *landed*: opens the stored source URL with
   `open`/`xdg-open`, or sets then opens when a url is given.

## Considered and rejected

- Auto-clearing clipboard after `--copy` — rejected: clearing the clipboard
  out from under the user is worse UX than leaving the value.
- Lock on screen lock (launchd agent watching `NSWorkspace`) — shelved: the
  delay between screen lock and agent reaction plus accidental lockouts make
  it feel worse than the security it adds for a personal vault.

## macOS menu bar interface (plan only)

Concept, inspired by openusage.ai: a small SwiftUI `MenuBarExtra` app that
bundles status providers, starting with:

- **secret**: vault lock state (daemon health), alias list, get→copy,
  Touch ID unlock, lock, `doctor`-style summary.
- **openusage**: AI usage/quota display (either link out to the existing app
  or embed its data later).
- Room for more providers (executor/agents status) once the pattern exists.

Open questions before building:

- Separate app vs. plugin slot inside openusage (openusage is a standalone
  macOS app; bundling into it means coordinating with its upstream).
- The menu bar app should shell out to the deployed `secret` binary (same
  session, keychain, daemon) rather than reimplementing vault logic.
- Notarization/sandbox: a personal, self-signed dev build is fine initially.

Next step when started: a throwaway prototype with only the secret provider
(lock state + copy value + Touch ID unlock) to validate the UX.
