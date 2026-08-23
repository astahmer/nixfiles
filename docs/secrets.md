# Secrets system

The `secret` CLI plus the SecretBar menu-bar/dock app manage machine-local
access to secrets stored behind pluggable backends. Deployed via nixfiles
(`modules/bitwarden.nix`, `modules/macos-apps.nix`,
`packages/secret`, `packages/secretbar`).

## Mental model

- **Configs map aliases → items.** Three scopes are merged per invocation:
  - *project*: `.secret.json` next to your repo (git-committed)
  - *global*: `~/.config/secret/config.json` — **symlinked to
    `assets/secret/global.json` in this repo**, so global aliases sync across
    machines through git. Add shared aliases there (or `secret set <alias>
    --global` and commit the change jj snapshots).
  - *local*: `.secret.local.json` — machine-specific overrides, never committed.
- **Values live in the backend**, never in configs or on disk unencrypted.
- **Session lifecycle**: the Bitwarden adapter runs a `bw serve` daemon that
  holds an unlocked session; most commands talk to the daemon instead of
  spawning `bw`. `secret lock` clears everything.

## Backends

Selected via the top-level `"backend"` key in the global config (default:
`bitwarden`):

| Backend | Notes |
| --- | --- |
| `bitwarden` | Full-featured: TOTP, sharing, sync across devices, session daemon. |
| `keychain` | macOS login keychain, one item per alias, instant/offline. One value per item, no TOTP. Service name defaults to `dev.astahmer.secret` (override: `SECRET_KEYCHAIN_SERVICE`). |

Unknown backends fail with the available list.

## Key verbs

```bash
secret status              # lock state + daemon summary
secret unlock --store      # interactive unlock; persists session + biometric cache
secret unlock --helper     # unlock from the Touch ID cache (CLI fallback path)
secret list / print        # alias inventory (--json available)
secret get/set/edit/rm     # CRUD
secret rotate <alias>      # new password, copied to clipboard
secret doctor [--ci]       # health check; `secret check` = non-interactive CI mode
secret pull                # refresh backend cache from server (bw sync)
```

### Shell integration

`secret env --export` prints `export KEY='value'` lines — direnv-ready:

```sh
# .envrc
eval "$(secret env --export)"
```

### Leak-guarded execution

```bash
secret run -- npm test
```

Injects project aliases into the child environment **and scrubs every known
secret value from its stdout/stderr** (replaced with `[scrubbed]`) before it
reaches the terminal or logs.

### CI gate

```bash
secret check   # exits 1 on missing/invalid/expired aliases; prints only problems
```

Expiry is per-alias in config: `"expiresAt": "2026-12-31"`.

## Biometric cache

`~/.config/secret/biometric-session` holds a session token gated by
LocalAuthentication. Deliberately a plain 0600 file, NOT an ACL-gated keychain
item — keychain ACLs bind to the creating binary's signature, so every Nix
rebuild triggered login-password prompts and silent denials.

Rules of the road:

- Reads require a fingerprint (finger-only when biometrics are enrolled).
- Seeded by any master-password unlock (`--store` or SecretBar's sheet).
- `secret lock` keeps the file; post-lock commands re-unlock via a fresh
  fingerprint prompt. Stale tokens are detected and dropped automatically.
- SecretBar authenticates **in-process** (LAContext) and hands the token to
  `secret unlock --session-stdin` — LAContext prompts do not present reliably
  from CLI processes spawned by menu-bar/agent apps.

## Gotchas learned the hard way

- A stale exported `BW_SESSION` used to make `secret unlock --store`
  unreachable ("refusing to store a rejected session"). `unlock` now ignores
  inherited sessions entirely — it always means "fresh session".
- Direct `bw status` can transiently reject freshly minted tokens; verdicts
  go through the daemon first.
- Global-scope aliases only exist per machine unless synced — keep them in
  `assets/secret/global.json`.

## SecretBar

Dock app + optional menu bar icon (Settings → Appearance). Panel header has
sync/lock/quit; the secrets tab is a sortable table (Secret/Project/Created/
Last used). Autostart passes `SECRET_AUTOSTART=1` so no window pops at login;
dock clicks reopen it.
