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
keys. Home Manager reconciles the provider and routing portions from that
template while preserving OpenCodex-owned account metadata and credentials.
When the local secrets file has values, activation materializes those values
into the private runtime config so the login service can use them without
putting keys in the repository.

The configured providers and public account selectors are:

| Selector | OpenCodex route | Purpose |
| --- | --- | --- |
| `commandcode` | CommandCode provider | CommandCode API-key provider (`cmdcode`) |
| `codex-perso` | `openai` account `@main` | Personal/main Codex login |
| `codex-work` | `openai` account pool entry | First non-main Codex pool account |
| `opencode` | OpenCode Go endpoint | OpenCode provider |

The work selector is derived from the first non-main `codexAccounts[]` entry,
so account ids and emails stay out of Nix. Add the work account through the
OpenCodex dashboard or `ocx account`, then re-run Home Manager if the account
was added after the initial activation.

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
