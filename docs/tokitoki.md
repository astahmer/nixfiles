# Tokitoki

Tokitoki is installed from the pinned `astahmer/tokitoki` flake input. The
macOS profile adds the CLI and builds the native menu-bar client from the same
source revision.

## Configuration and secrets

The declarative, non-secret defaults live in
`assets/tokitoki/config.template.json`. Home Manager writes the user-owned
`~/.config/tokitoki/config.json` during activation:

- existing Tokitoki settings are preserved;
- managed OpenCode Go account rows are seeded if missing;
- OpenRouter rows are removed;
- API keys are read at activation time through the `secret` CLI and never
  enter the Nix store or the checked-in template.

The two shared OpenCode Go aliases are read from the global secret config:
`opencode-go-mathias` and `opencode-go-manu`. The personal alias
`opencode-go-alex` is read from the project `.secret.json`, matching the
OpenCodex setup. Alias metadata is value-free and safe to commit.

## Automatic startup

On macOS, `launchd.agents.tokitoki` runs the Nix-managed menu-bar binary at
login and keeps it alive. Its wrapper sets `TOKITOKI_BIN` to the matching Nix
CLI, so the menu-bar app does not fall back to a stale checkout or an
unmanaged binary. Logs go to `~/Library/Logs/tokitoki.log`.

Useful checks:

```sh
tokitoki --version
tokitoki menubar --status
launchctl print "gui/$(id -u)/dev.tokitoki.menubar"
```

The Linux profile installs the CLI and configuration path, but does not enable
the macOS-only native menu-bar client.
