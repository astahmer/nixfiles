---
name: ai-accounts
description: Manage separate Codex ChatGPT and OpenCode Go subscription profiles in BB.
---

# BB AI Accounts

Use the **AI Accounts** page in BB to add profiles, edit their display names and
machine-local runtime paths, refresh Codex email identity, and enable or hide a
profile from BB's provider picker. Each enabled profile gets an independent
provider and live model catalog.

Use \`bb ai-accounts list\` to inspect profile names and paths. Use
\`bb ai-accounts login <account-id>\` to print its shell sign-in command.

Codex authentication is stored below the profile's \`CODEX_HOME\`. OpenCode Go
is an API-key subscription and is stored by OpenCode below its profile's
\`XDG_DATA_HOME\`. Do not copy provider auth files between profiles.
