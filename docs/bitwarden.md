# Bitwarden and the `secret` command

Bitwarden Password Manager remains the source of truth. The profile installs
`bw`, Bitwarden Desktop, optional agent-backed `rbw`, and a small global
`secret` command for scoped retrieval.

## Login

```sh
bw config server https://vault.bitwarden.eu
bw login
export BW_SESSION="$(bw unlock --raw)"
```

`rbw` is convenient for interactive lookups because its agent holds unlocked
state in memory. `secret` uses the official `bw` CLI and the current
`BW_SESSION`; it never stores or exports that session.

## Nix defaults

Nix deploys public aliases to `~/.config/secret/defaults.json`. Values are
never committed. Inspect configured aliases without touching the vault:

```sh
secret list
secret status
```

`secret status` prints the current auth state and the exact next command to
run: `bw login` when unauthenticated, `bw unlock` when locked, or the next
`secret` step when ready.

Retrieve exactly one configured value:

```sh
secret get github-token
```

## Writing secrets

Write or rotate a configured value without exposing it in the shell:

```sh
secret set github-token
secret set STRIPE_KEY --generate
```

`secret set` prompts on the terminal with echo disabled (or reads a piped
value), never prints the value, and creates the vault item when it does not
exist yet. Values are accepted only from the prompt, stdin, or `--generate`;
never pass one as an argument. Prefer item IDs over names in configs when two
vault items could share a name.

## Project `.env` files

Any app repository can add a value-free `.secret.json`:

```json
{
  "secrets": {
    "DATABASE_URL": { "item": "myapp/database-url", "field": "password" },
    "STRIPE_KEY": { "item": "myapp/stripe-key", "field": "password" }
  }
}
```

Then generate only those declared values:

```sh
secret env --output .env
```

Use `--config path/to/secrets.json` for another config. Existing `.env` files
are replaced atomically only after every requested value succeeds and are
written mode `0600`. `secret` never enumerates or synchronizes the whole vault.

The Nix-managed consumers use the same scoped model:

- `opencodex-opencode-go-api-key` maps to the OpenCodex dotenv variable.
- `github-token` maps to the raw GitHub token projection consumed by Executor.

## Why not `sdk-sm`/`bws`?

`bitwarden/sdk-sm` and `bws` are for the separate Bitwarden Secrets Manager
product. They require organization machine-account/project credentials and
cannot read a personal free-tier Password Manager vault. Keep using `bw` here.

If the goal later becomes encrypted secrets committed to a repository, evaluate
SOPS with age separately; it solves a different problem than runtime `.env`
projection.
