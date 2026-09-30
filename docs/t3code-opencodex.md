# T3 Code, OpenCode, and OpenCodex

## T3 Code settings and authentication

`assets/t3code/settings-seed.json` is the Nix-owned first-run settings source.
The activation merges only missing defaults into `~/.t3/userdata/settings.json`,
preserves existing provider choices, and no longer edits T3's SQLite project
defaults. It migrates the old T3 OpenCode 2 binary path to stable OpenCode 1;
the separate `opencode2` command remains installed.

OpenCode Go credentials come from the existing `secret` aliases and are written
to T3's supported provider-environment secret files. The app settings retain
only blank, redacted `OPENCODE_API_KEY` entries. T3 keeps these files in its
userdata `secrets` directory with mode `0700`, and secret files with mode
`0600`; these are local files, not encrypted Bitwarden records.

| T3 instance | `secret` alias | Scope |
| --- | --- | --- |
| `opencode-go` | `opencode-go-alex` | Project |
| `opencode_manu` | `opencode-go-manu` | Global |
| `opencode_mathias` | `opencode-go-mathias` | Global |

The `codex` provider stays the default with the current GPT-6.1 Sol selection.
Connect each ChatGPT subscription in T3 under **Settings → Providers → Codex**;
T3 supports adding multiple accounts there and keeps their OAuth sessions in
its own secret store. Those sessions are not copied from OpenCodex, whose OAuth
store is separate. See T3's [Codex provider guide](https://github.com/pingdotgg/t3code/blob/c18e5ea6ed741443a8ec4a5d22d4b6939b0ecd21/docs/user/providers-codex.md)
and OpenCode's [Go setup](https://opencode.ai/docs/go/).

## OpenCodex activation

OpenCodex remains installed and its configuration source stays in Nix. The
`nixfiles.opencodex.activation.enable` option defaults to `false`, so Home
Manager leaves the current config and running service alone. Set it to `true`
in a flake module to restore configuration and service reconciliation on
future applies.

## OpenCodex config

`~/.opencodex/config.json` is bootstrapped from
`assets/opencodex/config.template.json`. The template is the source of truth
for providers, model visibility, picker state, routing defaults, the native
GPT-6 Sol/Luna model roster, and the current 170-entry disabled-model
snapshot. It uses
`$VAR` references instead of committing API keys.

The native Codex config is initialized separately from
`assets/codex/config.template.toml`. That template deliberately omits the
loopback `openai_base_url`: OpenCodex injects and marks its routing line when
the proxy starts, so the value is recognized as managed rather than as a
user-owned override. Existing configs carrying the old Nix-seeded URL are
migrated during activation.

Every `nixapply` reconciles that managed config again. It stops the proxy when
needed, rebuilds the candidate from the template, injects available provider
keys, and imports it only when it differs. This intentionally resets stale
enabled/disabled model changes and stale active-account routing. The current
connected account metadata is carried forward so this is not an OAuth logout:
`~/.opencodex/auth.json` and `~/.opencodex/codex-accounts.json` remain in place,
and their credentials are not invalidated.

The account metadata is relabeled from the private email aliases on every
apply. Account ids are not hardcoded because OpenCodex creates a new id after
reauthentication. The known selectors are rebuilt as follows:

| Selector | OpenCodex route | Purpose |
| --- | --- | --- |
| `codex-perso` | native `openai` `@main` account | Main personal Codex login |
| `codex-work` | connected pool account matching the work email | Work Codex login |
| `codex-alex2` | connected pool account matching the Alex2 email | Second personal Codex login |

The native personal account is already represented by Codex's own
`~/.codex/auth.json`; it does not need an email secret or a `codexAccounts` row.
The pool account credentials stay in the local OCX account store. Nix can keep
already-connected accounts labeled correctly, but a new machine still needs
each OAuth login once because OAuth tokens must not be copied through Nix.

The stale `activeCodexAccountId` is not carried into the rebuilt config. That
removes the old persisted `codex-work` preference; the native Codex template
defaults to `codex-perso/gpt-6-luna`; the matching Sol model and explicit
account-qualified model selectors remain available when another account is
intentionally chosen.

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
`opencodex-codex-alex2-email` and `opencodex-codex-work-email`. None of those
values are stored in this repository. Create or update them with hidden
prompts:

```sh
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

`codex-alex2`, `codex-perso`, and `codex-work` are model-routing selectors;
they are not provider names to add in the dashboard. `@main` is the
deterministic native-login target; `__main__` is an internal credential
sentinel and must not be added as a pool row.

OpenCodex does not use a separate static `allowedModels` field per account.
Its Models page persists visibility in the top-level `disabledModels` list:
routed providers use IDs such as `opencode-go-alex/<model>` and
`opencode-go-manu/<model>`, while native Codex rows can use either a bare model
id (all eligible accounts) or an account-qualified id. The template owns those
exact IDs, so dashboard model-toggle edits are intentionally reapplied by
`nixapply`.

`syncResumeHistory = false` is also deliberate. The installed Codex state uses
paginated history and is live-owned by Codex; OpenCodex must leave that history
alone while updating the model catalog. Use `ocx sync` after an apply. Do not
use legacy history-recovery commands for this setup.

For an existing machine whose selector is missing or whose account list looks
stale, refresh the proxy and catalog:

```sh
ocx restart
ocx account list openai
ocx sync
```

Do not add an account or provider named `codex-perso`; that name is reserved
by the selector above.

The activation preserves extra accounts added through the OpenCodex dashboard,
while the two managed selectors remain bound to the matching email identities.
If an email alias is unavailable, the existing local account metadata remains
untouched. Add or switch accounts through the OpenCodex dashboard or `ocx
account`, then run `nixapply` after updating the aliases.

The OpenCodex activation also installs or repairs the upstream `ocx service`
launchd service, so the proxy starts at login and restarts after a crash.

Bitwarden setup and the explicit runtime projection command are documented
separately in [`docs/bitwarden.md`](./bitwarden.md).
