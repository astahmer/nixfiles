# BB AI Accounts

AI Accounts provides a BB page for separate Codex ChatGPT and OpenCode Go
profiles. Each enabled profile contributes a provider entry, with a short
account tag and color in the model picker.

## Sign in and choose models

Open **AI Accounts**, select or add a profile, then use **Copy sign-in
command** on the machine that runs its provider. The Codex command creates the
profile's `CODEX_HOME` before running `codex login`; sign in once for each
separate Codex account, then refresh to read the email claim from its local
`auth.json`. The command does not copy or expose credentials.
While a Codex profile is selected and has no detected email, the page checks
its account home periodically. Once the login writes `auth.json`, BB updates
the email and reloads that profile's live model catalog; **Refresh** remains
available for an immediate check.

OpenCode Go uses a separate `XDG_DATA_HOME` and its `opencode auth login` flow.
Credentials stay in OpenCode's own auth file.

The model section reads the complete Codex catalog or the selected OpenCode
Go provider catalog. It supports favorites, visibility checkboxes, order,
custom entries, and per-model default reasoning effort. The account-wide
**All models** composer action opens on a searchable view of every enabled
account, with provider tabs for narrower searches; BB's provider picker stays
available beside it. Account tags and colors are configurable.

Runtime paths inherit from the all-projects/all-machines default; project and
machine-specific paths override it. Nix owns profile names, paths, tags,
colors, and reasoning defaults. Model visibility, favorites, order, and custom
models can be edited in the page.

Codex usage limits are read directly from Codex app-server's
`account/rateLimits/read` using the selected `CODEX_HOME`. OpenCode Go limits
come from OpenCode's authenticated `/zen/go/v1/usage` endpoint using the API key
in that profile's own `auth.json`. This plugin does not use OpenCodex, its
management API, or its account mapping. BB's token and cost history comes from sessions
started in BB; the plugin API has no historical usage import surface.

## Nix setup

`modules/ai-accounts.nix` exposes `programs.bbAiAccounts` and wires it into the
macOS Home Manager profile. Defaults seed three Codex profiles and the existing
OpenCode Go Alex, Manu, and Mathias `secret` aliases. Apply Home Manager to
install the plugin and seed profiles. A Codex secret alias may contain the full
`auth.json`; OpenCode Go aliases are written to private `auth.json` files with
mode `0600`.

## CLI

```sh
bb ai-accounts list
bb ai-accounts list --json
bb ai-accounts login <account-id>
bb ai-accounts remove <account-id>
```

## Develop

```sh
npm ci
npm exec -- tsc --noEmit
bb plugin build
bb plugin install .
```
