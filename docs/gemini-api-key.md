# AI Studio (Gemini) API key for ModLens

The Google AI Studio API key powers the ModLens `gemini-api` provider — the
fastest free vision route (roughly 5-10s per image). ModLens has no keyless
default provider anymore: the `antigravity-cli` provider (backed by the `agy`
package) was removed because it breached the Google Antigravity Additional
Terms of Service (Section 6 bans using third-party tools against the Service
via Antigravity OAuth). The default is currently `openai` (see "Related keys"
below) — add this key if you'd rather default to `gemini-api` instead.

The key is a runtime secret only. It never lives in this repository: the repo
declares the value-free alias, Bitwarden holds the value, and the `secret`
command projects it into `GEMINI_API_KEY`.

## 1. Get the key

1. Open <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key**, copy the key, and close the dialog (the key is
   shown once).

No credit card is required and the free tier does not expire, but rate limits
apply (roughly 10-15 requests/min, ~1500/day for the default flash model).
Google may use free-tier traffic to improve products: avoid sending sensitive
images through this route; use a paid provider (openai, anthropic) instead.

## 2. Store it in Bitwarden

The alias already exists in the repo root `.secret.json`:

```json
"gemini-api-key": {
  "item": "nixfiles/gemini-api-key",
  "field": "password",
  "env": "GEMINI_API_KEY"
}
```

Write the value (prompts with echo disabled, creates the vault item if
missing, never prints the value):

```sh
cd ~/dev/nixfiles
secret set gemini-api-key
```

Verify the wiring without printing anything:

```sh
secret lint    # offline config validation
secret doctor  # resolves every alias against the vault
```

## 3. Use it with ModLens

Preferred: project the key into the command's environment so it never lands in
`~/.modlens/config.json`:

```sh
secret run --optional gemini-api-key -- modlens -i <image> -p gemini-api
```

Or generate a `.env` once (written atomically, mode 0600) and let ModLens pick
up the variable:

```sh
secret env --output .env
modlens -i <image> -p gemini-api
```

Alternative: persist the key in ModLens' own config (`~/.modlens/config.json`,
mode 0600, masked by `modlens config show`):

```sh
modlens config set gemini-api.apiKey <key>
modlens config set provider gemini-api   # optional: make it the default
```

Precedence: CLI flags > environment variables > config file > defaults.

Provider switching and the other providers (openai, anthropic, claude-cli) are
documented in the deployed skill at
`~/.agents/skills/modlens/references/configure.md`; the same file ships in the
package under `packages/modlens/`.

## 4. Rotating or removing the key

```sh
secret rotate gemini-api-key   # new random value -> Bitwarden + clipboard
```

To invalidate a leaked key, delete it in AI Studio (API keys page) and store a
fresh one with `secret set gemini-api-key`. Removing the key entirely has no
effect on the current default (`openai`, see "Related keys") unless you had
also set `provider` to `gemini-api`; nothing else in the profile reads
`GEMINI_API_KEY`.

## Related keys

- ModLens is currently set to default to `openai` (`provider` in
  `~/.modlens/config.json`, plus `openai.baseUrl` =
  `https://api.openai.com/v1` and `openai.model` = `gpt-4.1-mini`). The
  `openai-key` alias in `.secret.json` projects `OPENAI_API_KEY`; run ModLens
  through `secret run --optional openai-key -- modlens ...` (or `secret env
  --output .env`) so the key never lands in the config file. Switch to
  `gemini-api` with this doc's key instead if you'd rather not depend on
  OpenAI.
- ModLens can also use Anthropic (`ANTHROPIC_API_KEY`); that alias is not
  declared in `.secret.json` — add it there if you use it.
- `modsearch` has no configured auth path anymore: it previously rode the agy
  sign-in, which was removed for the same ToS reason. Its optional Tavily
  fallback would need a `tavily-api-key` alias (`TAVILY_API_KEY`) declared the
  same way before `secret env` can project it — not set up yet.
