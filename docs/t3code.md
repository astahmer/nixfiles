# T3 Code and OpenCode

## T3 Code settings and authentication

`assets/t3code/settings-seed.json` is the Nix-owned first-run settings source.
The activation merges only missing defaults into `~/.t3/userdata/settings.json`,
preserves existing provider choices, and no longer edits T3's SQLite project
defaults. It migrates the old T3 OpenCode 2 binary path to stable OpenCode 1;
the separate `opencode2` command remains installed.

OpenCode Go credentials come from the existing `secret` aliases and are written
to T3's supported provider-environment secret files. The app settings retain
only blank, redacted `OPENCODE_API_KEY` entries. T3 keeps these files in its
userdata `secrets` directory with mode `0700`, and secret files with mode
`0600`; these are local files, not encrypted Bitwarden records.

| T3 instance | `secret` alias | Scope |
| --- | --- | --- |
| `opencode-go` | `opencode-go-alex` | Project |
| `opencode_manu` | `opencode-go-manu` | Global |
| `opencode_mathias` | `opencode-go-mathias` | Global |

Codex models come from official model discovery; Nix seeds no custom model or
default model selection. Nightly is the only T3 app installed by Nix; old Alpha
bundles in either Applications directory are leftover installations.

Nix seeds `codex-alex2` as a separate Codex instance. Its shadow home lives
under `~/.local/share/t3code/codex`; the regular `~/.codex` login remains
separate. On each machine, sign into that account once by running:

```sh
CODEX_HOME="$HOME/.local/share/t3code/codex/codex-alex2" codex -c 'cli_auth_credentials_store="file"' login
```

Choose the matching ChatGPT account in the browser. If the
browser silently selects the wrong account, sign out there or open the login
URL in a private window. After login finishes, refresh the status beside
**Checked…** in T3. Codex CLI stores each login under that command's
`CODEX_HOME` ([credential-store configuration](https://developers.openai.com/codex/config-reference));
these machine-local auth files are not Nix settings. This leaves the normal
`~/.codex` login intact.

T3 supports multiple Codex accounts. See T3's
[Codex provider guide](https://github.com/pingdotgg/t3code/blob/c18e5ea6ed741443a8ec4a5d22d4b6939b0ecd21/docs/user/providers-codex.md)
and OpenCode's [Go setup](https://opencode.ai/docs/go/).

