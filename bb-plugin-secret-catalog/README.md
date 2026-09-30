# Secret Catalog for BB

Browse configured aliases from the local `secret` CLI, edit aliases and values, reveal or copy a value on demand, and give BB agents tools to list aliases or retrieve one value. Values remain in the configured secret backend until a user saves or reveals one, or an agent explicitly calls `secret_get`.

The plugin runs `secret print`, `secret get`, `secret get --copy`, `secret set`, `secret mv`, and `secret unset` on the selected BB host. It never reads vault storage or persists secret values itself. Save sends the value through stdin to the CLI, never in command arguments. New aliases default to Login items; the form can also create Secure Notes.

## Use

Open **Secret Catalog**. It selects the primary connected BB machine (or the first connected machine) and immediately loads global aliases. Use the machine selector to switch hosts. The **All**, **Project**, **Global**, and **Local** filters show value-free alias metadata; use **Browse…** to pick a project directory on the selected host, or paste a path and press Enter.

**New alias** creates an alias in the selected scope. **Edit alias / value** can rename an alias and update its value; leaving the value blank keeps it unchanged. **Remove alias** removes the configuration alias only and does not delete the vault item. Saves call `secret set` through stdin. **Copy with secret CLI** uses the selected host's clipboard; **Reveal value** shows the value in the BB window until hidden or another alias is selected.

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
