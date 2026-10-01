# Secret Catalog for BB

Browse configured aliases from the local `secret` CLI, reveal or copy a value on demand, and give BB agents tools to list aliases or retrieve one value. Values remain in the configured secret backend until a user reveals a value or an agent explicitly calls `secret_get`.

The plugin runs `secret print --all --json`, `secret get`, and `secret get --copy` on the selected BB host. It never reads vault storage or persists secret values itself. Alias creation and editing stay in SecretBar or the `secret` CLI.

## Use

Open **Secret Catalog**, enter a BB host ID and a project directory on that host, then load aliases. Listing is value-free. **Copy with secret CLI** uses the selected host's clipboard. The value control cycles from hidden dots to a preview showing the first and last four characters, then to the full value. Select it again to hide the value.

Agent tools `secret_list` and `secret_get` are bound to the thread's active execution environment, so they need no host or path parameters. `secret_get` returns plaintext into the agent context, so use it only when the current task needs that value.

The command line also supports:

```sh
bb secret-catalog list /absolute/project/path --host <host-id>
bb secret-catalog get /absolute/project/path github-token --host <host-id>
```

The host must have `secret` installed and configured. The CLI resolves project, global, and local aliases according to its normal scope rules.

## Development

```sh
npm install
bb plugin types
bb plugin build
```
