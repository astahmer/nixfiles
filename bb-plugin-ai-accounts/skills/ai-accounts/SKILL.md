---
name: ai-accounts
description: Manage separate Codex and OpenCode Go subscription logins in BB.
---

# AI account profiles

Use `bb ai-accounts list` to see configured profiles. The active account is
selected per provider with `bb ai-accounts use <codex|opencode-go> <name>`.
The selection applies when BB starts or resumes a provider session; start a
new thread after switching accounts.

Add an account using a machine-local absolute path:

```sh
bb ai-accounts add codex <name> <absolute-CODEX_HOME>
bb ai-accounts add opencode-go <name> <absolute-XDG_DATA_HOME>
```

Then run `bb ai-accounts login <provider> <name>` and execute the printed
command in a terminal on the target machine. Codex profiles use file-backed
credentials. OpenCode Go credentials remain in OpenCode's own data directory.
Never copy authentication files between profiles or include token contents in
BB settings.
