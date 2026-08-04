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
keys. OpenCodex resolves those references at runtime, so the public repository
contains no secrets.

The retained providers are:

- `openai`, using forwarded Codex authentication
- `opencode-go`, using the OpenCode Go API key

The per-machine secret template is deployed at
`~/.config/opencodex/secrets.env.example`:

```sh
OPENCODEX_OPENCODE_GO_API_KEY=...
```

Bitwarden setup and the explicit runtime projection command are documented
separately in [`docs/bitwarden.md`](./bitwarden.md).
