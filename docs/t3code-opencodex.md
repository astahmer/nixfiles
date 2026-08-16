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
`assets/opencodex/config.template.json`, which is the full merged runtime
config (providers, model routing, disabled models, account selectors) with
`$VAR` key references instead of API keys. The template is the source of
truth for the config shape; activation materializes the four provider keys
from the repo's Bitwarden-backed `secret` config, so fresh machines get the
complete setup without committing keys to the public repo.

The activation still handles the legacy provider migration, public account
selectors, and explicit secret injection. It only writes when initialization
or one of those migrations actually changes the file. Dashboard and `ocx`
edits that add new runtime state (custom models, extra key pools, accounts)
persist because the config is re-imported from the merged candidate.

The four provider keys are read by activation via `secret get --config
.secret.json` (falling back to `~/.config/opencodex/secrets.env` for the two
original keys when Bitwarden is locked):

| Secret alias | Env var | Provider usage |
| --- | --- | --- |
| `opencodex-commandcode-api-key` | `OPENCODEX_COMMANDCODE_API_KEY` | CommandCode provider key |
| `opencode-go-alex` | `OPENCODEX_OPENCODE_GO_API_KEY` | OpenCode provider primary pool key |
| `opencode-go-manu` | `OPENCODEX_OPENCODE_GO_MANU_KEY` | `opencode-go-manu` provider + OpenCode pool entry |
| `opencode-go-mathias` | `OPENCODEX_OPENCODE_GO_MATHIAS_KEY` | OpenCode pool entry |

The per-machine secret template is deployed at
`~/.config/opencodex/secrets.env.example`:

```sh
OPENCODEX_COMMANDCODE_API_KEY=...
OPENCODEX_OPENCODE_GO_API_KEY=...
```

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
