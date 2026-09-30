# BB AI Accounts

AI Accounts adds a BB navigation page for separate Codex ChatGPT and OpenCode
Go profiles. Each enabled profile registers its own provider entry, so account
names and provider-discovered models appear in BB’s model picker.

## Use it

1. Open **AI Accounts** from BB’s sidebar.
2. Add a Codex or OpenCode Go account, edit its display name, and choose its
   runtime path scope.
3. Click **Copy sign-in command** and run it in a terminal on the machine that
   launches the provider. Codex uses `CODEX_HOME`; OpenCode Go uses an isolated
   `XDG_DATA_HOME` and its `opencode auth login` flow.
4. Start a new BB thread and choose that account’s provider entry.

The page reads and stores only the email claim from Codex `auth.json`; it never
returns or logs the token. OpenCode Go credentials stay in OpenCode’s auth file.
The model section shows the live catalog for the selected machine and supports
favorites, visibility, ordering, and custom model entries. Runtime paths inherit
from the all-projects/all-machines default, with more specific project and
machine paths taking precedence.

Subscription quota meters are not included yet. Codex ACP does not expose a
stable usage method, and OpenCode Go usage needs the proxy’s usage endpoint and
account mapping.

## Runtime requirements

- Codex accounts need `codex` and `npx` available on the provider machine. The
  plugin pins `@agentclientprotocol/codex-acp` to `2.0.1`; `npx` fetches its
  published package on first use.
- OpenCode Go accounts need `opencode` on the provider machine. Go uses an
  OpenCode API key, not OAuth. Run `opencode auth login` with the profile’s
  `XDG_DATA_HOME` to connect it.
- Account paths are absolute paths on the provider machine.

Credentials and session state are isolated by account path. Codex conversation
state is not shadowed or shared between homes as it is in T3 Code.

## Nix setup

`modules/ai-accounts.nix` exposes `programs.bbAiAccounts` and is wired into the
macOS Home Manager profile. Defaults seed three Codex profiles and the existing
OpenCode Go Alex, Manu, and Mathias `secret` aliases. Apply the Home Manager
profile to install the plugin and seed the accounts. Existing UI edits to a
seeded profile are retained across activation. A Codex secret alias may contain
the complete `auth.json` JSON document; OpenCode Go aliases are written as
private `auth.json` files with mode `0600`.

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
