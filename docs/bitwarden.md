# Bitwarden and local secret projections

Bitwarden Password Manager remains the source of truth for the few runtime
secrets used by this setup. The Home Manager module installs the official
`bw` CLI, Bitwarden Desktop, the optional agent-backed `rbw` client, and the
explicit `secrets-refresh` projection command.

## Interactive access

`bw` is the official, fully featured client. It requires an unlocked session
key for vault reads:

```sh
bw config server https://vault.bitwarden.eu
bw login
export BW_SESSION="$(bw unlock --raw)"
```

`rbw` is optional and is more convenient for interactive lookups because its
background agent keeps the unlocked state in memory instead of requiring
`BW_SESSION` to be passed around. It is not used by automation and does not
replace the official `bw` CLI for the projection script.

## Runtime projections

`secrets-refresh` is intentionally manual. Run it after unlocking Bitwarden
or after changing a vault item:

```sh
secrets-refresh
unset BW_SESSION
```

It reads these stable item names:

- `nixfiles/opencodex-opencode-go-api-key`
- `nixfiles/github-token`

It writes mode-600 files used by local tools:

- `~/.config/opencodex/secrets.env`
- `~/.config/opencode/github-token`

The projected GitHub token file is consumed by Executor's GitHub integration.

The script writes through temporary files and atomic renames. It does not
export secrets globally, and Home Manager does not run it during every switch.
If the vault is locked, existing projections remain unchanged until the next
manual refresh.

## Why not another hosted secret manager?

Bitwarden Password Manager already provides the cross-machine encrypted vault
needed here. Bitwarden Secrets Manager (`bws`) is a separate machine-account
product, not a free personal-plan extension, so adding it would introduce a
second hosted system and another token without improving this small workflow.

If the main pain is interactive CLI friction, use `rbw`. If the goal later
becomes encrypted project secrets committed to the repository, evaluate SOPS
with age separately; it solves a different problem and should not replace the
runtime projection needed by OpenCodex and MCP clients.
