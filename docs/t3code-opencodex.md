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
and the two account emails from the repo's Bitwarden-backed `secret` config,
so fresh machines get the complete setup without committing credentials or
email identities to the public repo. The pool account ids in the template are
the stable provider account ids shown by OpenCodex; OAuth tokens and the local
credential records remain machine-local.

The activation still handles the legacy provider migration, public account
selectors, and explicit secret injection. It only writes when initialization
or one of those migrations actually changes the file. Dashboard and `ocx`
edits that add new runtime state (custom models, extra key pools, accounts)
persist because the config is re-imported from the merged candidate.
The checked-in template also carries the 161-entry OpenCodex 2.42.0 model
visibility snapshot for the configured providers, including
provider/account-qualified rows. Activation
seeds that snapshot only when an older config has no `disabledModels` field;
an existing list, including an intentionally empty one, remains dashboard-owned
so later UI toggles are not silently reverted by `nixapply`.

The four provider keys are read by activation via the project or global
`secret` config; the local `~/.config/opencodex/secrets.env` remains a fallback
when Bitwarden is locked:

| Secret alias | Env var | Provider usage |
| --- | --- | --- |
| `opencodex-commandcode-api-key` | `OPENCODEX_COMMANDCODE_API_KEY` | CommandCode provider key |
| `opencode-go-alex` | `OPENCODEX_OPENCODE_GO_API_KEY` | OpenCode provider primary pool key |
| `opencode-go-manu` | `OPENCODEX_OPENCODE_GO_MANU_KEY` | `opencode-go-manu` provider + OpenCode pool entry |
| `opencode-go-mathias` | `OPENCODEX_OPENCODE_GO_MATHIAS_KEY` | OpenCode pool entry |

The two pool-account rows use private `secret` aliases for their email fields:
`opencodex-codex-alex2-email` and `opencodex-codex-work-email`. The native
`codex-perso` route uses OpenCodex's machine-local `@main` credential and has
no `codexAccounts` row; its identity is kept separately in the private
`opencodex-codex-perso-email` alias. None of the three values are stored in
this repository. Create or update them with hidden prompts:

```sh
secret set opencodex-codex-perso-email
secret set opencodex-codex-alex2-email
secret set opencodex-codex-work-email
```

The per-machine secret template is deployed at
`~/.config/opencodex/secrets.env.example`:

```sh
OPENCODEX_COMMANDCODE_API_KEY=...
OPENCODEX_OPENCODE_GO_API_KEY=...
OPENCODEX_OPENCODE_GO_MANU_KEY=...
OPENCODEX_OPENCODE_GO_MATHIAS_KEY=...
```

The configured providers and public account selectors are:

| Selector | OpenCodex route | Purpose |
| --- | --- | --- |
| `commandcode` | CommandCode provider | CommandCode API-key provider (`cmdcode`) |
| `codex-perso` | native `openai` `@main` account | Main personal Codex login |
| `codex-work` | `openai` pool account with the stable configured account id | Work Codex login |
| `codex-alex2` | `openai` pool account with the stable configured account id | Second personal Codex login |
| `opencode` | OpenCode Go endpoint | OpenCode provider |
| `opencode-free` | OpenCode free endpoint | Key-optional free model catalog |

`codex-alex2`, `codex-perso`, and `codex-work` are model-routing selectors;
they are not provider or account names to add in the dashboard. `codex-perso`
always uses native `@main`, while the pool selectors target the stable account
ids in the template. `@main` is the deterministic native-login target;
`__main__` is an internal credential sentinel and must not be added as a pool
row. The
activation migration clears all persisted account pauses on every rebuild
(older templates paused `__main__` by default, and OpenCodex auto-pauses
drained accounts), so a quota window can never surface as a misleading 401
while the account still has weekly headroom. Pauses are runtime state and
rebuilds re-enable every account.

On a new machine, apply Home Manager first, then complete the OpenAI OAuth
login inside OpenCodex. OAuth tokens and credential records stay in the
user-owned OpenCodex runtime and are never copied through Nix. Run `nixapply`
again after the login so the secret-backed email fields are refreshed while
the deterministic pool selectors remain bound to the configured account ids;
then refresh the catalog with `ocx sync`.

OpenCodex does not use a separate static `allowedModels` field per account.
Its Models page persists visibility in the top-level `disabledModels` list:
routed providers use IDs such as `opencode-go-alex/<model>` and
`opencode-go-manu/<model>`, while native Codex rows can use either a bare model
id (all eligible accounts) or an account-qualified id. The template preserves
those exact IDs, so per-provider/account toggles are part of the Nix bootstrap;
`ocx sync` still discovers the native entitlement roster locally and may add
new rows without copying OAuth state into Nix.

For an existing machine whose selector is missing or whose account list looks
stale, restart the proxy first so it reloads the on-disk account state:

```sh
ocx restart
ocx account list openai
ocx sync
```

Do not add an account or provider named `codex-perso`; that name is reserved
by the selector above.

The activation preserves extra accounts added through the OpenCodex dashboard,
while the two managed selectors remain bound to their deterministic ids. If a
secret alias is unavailable, an existing local email is preserved and a
first-run placeholder is removed rather than written literally. Add or switch
accounts through the OpenCodex dashboard or `ocx account`, then run `nixapply`
after updating the aliases.

The per-machine secret template is deployed at
`~/.config/opencodex/secrets.env.example`:

```sh
OPENCODEX_COMMANDCODE_API_KEY=...
OPENCODEX_OPENCODE_GO_API_KEY=...
OPENCODEX_OPENCODE_GO_MANU_KEY=...
OPENCODEX_OPENCODE_GO_MATHIAS_KEY=...
```

The OpenCodex activation also installs or repairs the upstream `ocx service`
launchd service, so the proxy starts at login and restarts after a crash.

Bitwarden setup and the explicit runtime projection command are documented
separately in [`docs/bitwarden.md`](./bitwarden.md).
