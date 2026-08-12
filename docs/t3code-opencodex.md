# T3 Code, OpenCode, and OpenCodex

## T3 Code provider defaults

Home Manager runs `assets/t3code/seed-provider-instances.mjs` on every switch.
It merges an idempotent OpenCode Go provider instance into
`~/.t3/userdata/settings.json`, taking a backup before the first change and
leaving existing user-edited instances alone.

| Instance | Driver | Purpose |
| --- | --- | --- |
| `opencode-go` | OpenCode | OpenCode CLI with an `OPENCODEX_OPENCODE_GO_API_KEY` placeholder |

The placeholder is deliberately non-sensitive so it stays visible in T3's
settings for editing. T3's OpenCode driver can also read the OpenCode CLI auth
store at `~/.local/share/opencode/auth.json`.

## OpenCodex config

`~/.opencodex/config.json` is bootstrapped from
`assets/opencodex/config.template.json` with `$VAR` references instead of API
keys. The template supplies first-run defaults only; once the local config
exists, it is authoritative. This means dashboard and `ocx` edits—including
intentional field removals—persist across Home Manager switches instead of
being overwritten by Nix. The activation still handles the legacy provider
migration, public account selectors, and explicitly configured secret
injection. It only writes when initialization or one of those migrations
actually changes the file.

Changing the template updates future bootstraps. For an existing installation,
use the dashboard or `ocx config` for an intentional setting change so the
runtime config remains the source of truth.

When the local secrets file has values, activation materializes those values
into the private runtime config so the login service can use them without
putting keys in the repository. Those two provider key fields remain
Nix-owned when the secret file contains a value.

The configured providers and public account selectors are:

| Selector | OpenCodex route | Purpose |
| --- | --- | --- |
| `commandcode` | CommandCode provider | CommandCode API-key provider (`cmdcode`) |
| `codex-perso` | `openai` account `@main` | Personal/main Codex login |
| `codex-work` | `openai` account pool entry | First non-main Codex pool account |
| `opencode` | OpenCode Go endpoint | OpenCode provider |

The work selector is seeded from the first non-main `codexAccounts[]` entry
only when `codex-work` is missing or stale, so account ids and emails stay out
of Nix while an existing dashboard choice is preserved. Add or switch the work
account through the OpenCodex dashboard or `ocx account`.

The per-machine secret template is deployed at
`~/.config/opencodex/secrets.env.example`:

```sh
OPENCODEX_COMMANDCODE_API_KEY=...
OPENCODEX_OPENCODE_GO_API_KEY=...
```

The OpenCodex activation also installs or repairs the upstream `ocx service`
launchd service, so the proxy starts at login and restarts after a crash.

Bitwarden setup and the explicit runtime projection command are documented
separately in [`docs/bitwarden.md`](./bitwarden.md).
