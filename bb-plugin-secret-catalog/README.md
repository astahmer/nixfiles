# Secret Catalog for BB

Browse configured aliases from the local `secret` CLI, add or update a value, reveal or copy a value on demand, and give BB agents tools to list aliases or retrieve one value. Values remain in the configured secret backend until a user saves or reveals one, or an agent explicitly calls `secret_get`.

The plugin runs `secret print --all --json`, `secret get`, `secret get --copy`, and `secret set` on the selected BB host. It never reads vault storage or persists secret values itself. Save sends the value through stdin to the CLI, never in command arguments. New aliases default to Login items; the form can also create Secure Notes.

## Use

Open **Secret Catalog**, enter a BB host ID and a project directory on that host, then load aliases. Listing is value-free. **New alias** creates a project alias; **Update value** updates a project or global alias. Local aliases remain managed through SecretBar or the CLI. Saving calls `secret set` through stdin. **Copy with secret CLI** uses the selected host's clipboard; **Reveal value** sends the value to the BB window until hidden or another alias is selected.

Agent tools `secret_list` and `secret_get` are bound to the thread's active execution environment, so they need no host or path parameters. `secret_get` returns plaintext into the agent context, so use it only when the current task needs that value.

The command line also supports:

```sh
bb secret-catalog list /absolute/project/path --host <host-id>
bb secret-catalog get /absolute/project/path github-token --host <host-id>
```

The host must have `secret` installed and configured. The CLI resolves project, global, and local aliases according to its normal scope rules.

## Development

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
bb plugin types
bb plugin build
```
