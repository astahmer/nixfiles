# BB AI Accounts

AI Accounts adds a BB navigation page for separate Codex ChatGPT and OpenCode
Go profiles. Every enabled profile registers its own native BB provider entry,
so account names and live-discovered models appear in the model picker.

## Use it

1. Open **AI Accounts** from BB’s sidebar.
2. Add a Codex or OpenCode Go account, edit its display name and account path,
   then save.
3. Copy the sign-in command and run it in a terminal on the machine that runs
   the provider. Codex uses \`CODEX_HOME\`; OpenCode Go uses an isolated
   \`XDG_DATA_HOME\` and its \`opencode auth login\` flow.
4. Start a new BB thread and choose the provider entry named for that account.
   BB’s ACP bridge reads the provider’s current model catalog.

The account page can refresh the email from the Codex \`auth.json\` ID token. It
returns and stores only the email claim; the token stays in the provider file.
OpenCode Go credentials remain in OpenCode’s own auth file.

Each profile can be disabled from the provider picker and can hide exact model
IDs from its live catalog. Leave the model list blank to keep every model the
provider discovers. BB re-registers the provider after a profile save; existing
threads keep their provider ID.

## Runtime requirements

- Codex accounts need \`codex\` and \`npx\` available on the BB provider machine.
  The plugin pins the published \`@agentclientprotocol/codex-acp\` adapter to
  \`2.0.1\`; \`npx\` fetches that prebuilt npm release on first use.
- OpenCode Go accounts need \`opencode\` on the provider machine. Go uses an
  OpenCode API key, not OAuth. Run \`opencode auth login\` with the profile’s
  \`XDG_DATA_HOME\` to connect it.
- The account path is a machine-local absolute path. Replace the suggested
  \`/Users/your-user/...\` path with a real path on the machine launching the
  provider.

Credentials and session state are isolated by account path. This does not
shadow or share Codex conversation state between homes as T3 Code does.

## CLI

\`\`\`sh
bb ai-accounts list
bb ai-accounts list --json
bb ai-accounts login <account-id>
\`\`\`

## Develop

\`\`\`sh
npm install
npm exec -- tsc --noEmit
bb plugin build
bb plugin install .
\`\`\`
