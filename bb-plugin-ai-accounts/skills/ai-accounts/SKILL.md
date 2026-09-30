---
name: ai-accounts
description: Manage separate Codex ChatGPT and OpenCode Go subscription profiles in BB.
---

# BB AI Accounts

Use the **AI Accounts** page in BB to add profiles, edit display names and
runtime paths by project and machine, refresh Codex email identity, and enable
or hide a profile from BB's provider picker. Each enabled profile gets an
independent provider and live model catalog. Choose models with the catalog
checkboxes; BB reads the available model IDs from the selected provider machine.

Use \`bb ai-accounts list\` to inspect profile names and paths. Use
\`bb ai-accounts login <account-id>\` to print its shell sign-in command.

Codex authentication is stored below the profile's `CODEX_HOME`. OpenCode Go
is an API-key subscription and is stored by OpenCode below its profile's
`XDG_DATA_HOME`. Do not copy provider auth files between profiles. The email
reader returns only the email claim, never a token.

Nix-managed defaults live in `modules/ai-accounts.nix`; secret aliases are
materialized by `assets/ai-accounts/seed.mjs` with private file permissions.
