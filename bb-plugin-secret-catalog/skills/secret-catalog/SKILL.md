---
name: secret-catalog
description: Use the local secret CLI through Secret Catalog to list configured aliases and retrieve values only when a task needs them.
---

# Secret Catalog

- Use `secret_list` to discover configured alias names and metadata. It does not return values.
- Use `secret_get` only when the current task requires a specific credential. Its plaintext result enters the agent context.
- Do not repeat secret values in chat, logs, source files, or command arguments. Pass values through protected stdin or a secret-aware CLI when a workflow supports it.
- Agent tools are restricted to the thread's active execution environment and use its project directory and BB host.
- If an alias is missing or the vault is locked, explain the next `secret` CLI or SecretBar action without asking the user to paste a value into chat.
