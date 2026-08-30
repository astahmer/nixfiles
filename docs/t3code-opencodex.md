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

Pool-account identity matching also uses private `secret` aliases:
`opencodex-codex-alex2-email` and `opencodex-codex-work-email`. Their values
are read in-memory during activation and are never stored in this repository.
Create or update them with the hidden prompt:

```sh
secret set opencodex-codex-alex2-email
secret set opencodex-codex-work-email
```

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
| `codex-perso` | native `openai` `@main` account | Main personal Codex login |
| `codex-work` | `openai` pool account selected by private identity alias | Work Codex login |
| `opencode` | OpenCode Go endpoint | OpenCode provider |

`codex-perso` and `codex-work` are model-routing selectors; they are not
provider or account names to add in the dashboard. `codex-perso` always uses
native `@main`, while `codex-work` uses the account selected by its private
identity alias. The
activation migration clears all persisted account pauses on every rebuild
(older templates paused `__main__` by default, and OpenCodex auto-pauses
drained accounts), so a quota window can never surface as a misleading 401
while the account still has weekly headroom. Pauses are runtime state and
rebuilds re-enable every account.

For an existing machine whose selector is missing or whose account list looks
stale, restart the proxy first so it reloads the on-disk account state:

```sh
ocx restart
ocx account list openai
ocx sync
```

Do not add an account or provider named `codex-perso`; that name is reserved
by the selector above.

The pool selectors preserve existing runtime bindings when their private
aliases are unavailable, so account ids and identity values stay out of Nix.
Add or switch accounts through the OpenCodex dashboard or `ocx account`, then
run `nixapply` after updating the aliases.

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
