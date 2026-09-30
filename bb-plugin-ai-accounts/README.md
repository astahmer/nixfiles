# BB AI Accounts

This plugin keeps named Codex and OpenCode Go login profiles and selects one
profile per provider for new BB sessions. It contributes `CODEX_HOME` to BB's
native Codex provider and `XDG_DATA_HOME` to BB's `acp-opencode` provider.

Each profile uses its own provider path. Codex conversation and config state is
isolated by account; unlike T3 Code's shadow-home feature, this plugin does not
share Codex threads/config between accounts. It does not copy or inspect
authentication files. OpenCode Go OAuth credentials stay in OpenCode's own
`auth.json` below the selected XDG data root.

## Commands

```sh
bb ai-accounts add codex work /Users/alex/.local/share/bb-ai-accounts/codex/work
bb ai-accounts login codex work
bb ai-accounts use codex work

bb ai-accounts add opencode-go work /Users/alex/.local/share/bb-ai-accounts/opencode/work
bb ai-accounts login opencode-go work
bb ai-accounts use opencode-go work

bb ai-accounts list
```

Run each printed `login` command in a terminal on every machine that should
use the profile, then start a new BB thread with Codex or OpenCode. Account
directories are machine-local; use the same absolute path on each enrolled
machine or register the path that exists there. `remove` deletes only the BB
profile record and never deletes local credentials.

The plugin stores only account labels, provider names, paths, and active
selections in BB plugin storage. It does not read, copy, or store OAuth tokens.

## Install locally

```sh
npm install
bb plugin install .
```

After source changes, rebuild and reload with `bb plugin build` and
`bb plugin reload ai-accounts`.
