# BB to DSH migration

This is the versioned migration record and source-of-truth plan for a first-party DSH setup. It is also exposed from `$DSH_HOME/BB-MIGRATION.md`. BB is left installed and unchanged. No BB plugin source is copied or depended on. No DSH Market package is used by the migration profile.

## Discovery snapshot

Checked 2026-10-02 on Apple Silicon macOS.

- BB CLI: `0.44.0`; local data directory: `~/.bb`; current project: `nixfiles`; active plugin service reports no plugins needing attention.
- BB plugin registry: 62 installed; 52 enabled and running; 10 disabled. Inventory below is from `bb plugin list --json`, which reports versions, source/provenance, running status, frontend bundles, service/schedule declarations, and contributed capabilities. Descriptions and status are verified registry metadata; underlying behavior is not source-audited unless explicitly called out.
- DSH CLI/package: `@deepseek-ai/dsh@0.2.0-rc.2`; shell-default Node `v24.20.0`; `DSH_HOME` is unset and the active home is `~/.dsh`. DSH's config-schema collector fails under Node 24.20.0 with `node-addon-require-builtin` / `Unsupported/no-getter` on Apple arm64. The same schema command succeeds under the already-installed fnm Node `v22.23.3`, with four `unrecognized Loader tree carrier` warnings from schema collection. DSH runtime checks will use Node 22; no Node or DSH upgrade was made.
- Installed DSH profiles at discovery: `web` and `desktop`. The existing `web` profile has `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `dshmarket` in its bundle list; its own package dependency is `dshmarket@^1.66.7`. Its local patch sets only a UI welcome-notice version. Its `cordis.yml` is generated output and must not be edited. After recording the initial mapping, the separate `bb-migration` profile was initialized from the shipped web template; its generated manifest includes only the first-party base and web bundles and has no dependencies. The stock `web` and `desktop` profiles were not changed.
- The DSH web endpoint at `http://localhost:3080` returned HTTP 401 during one authorized local probe. This proves an HTTP service answered then, not that a browser session or model request is authenticated. A second sandboxed probe could not connect; service availability must be rechecked outside that restriction. Running `dsh web --help` attempted to write generated `~/.dsh/profiles/web/cordis.yml` and was denied by the restricted shell; it did not alter the profile.
- BB server-backed metadata was queried via the documented BB CLI. Available providers are Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, three Codex account profiles, and three OpenCode Go account profiles. The Codex catalog includes GPT-6.1-Sol as its default plus GPT-6-Astra, GPT-6-Sol, GPT-6-Luna, GPT-5.6-Sol/Terra/Luna, and GPT-5.5. The `EM · Codex` account catalog defaults to GPT-6-Luna; the OpenCode Go Alex catalog includes DeepSeek V4.1 Flash and Fledge Alpha Free. “Available” is the provider registry state; it does not prove a signed-in session. `codex login status` reports the host Codex CLI is logged in using ChatGPT. It does not verify the other five account profiles. API-key/account secrets were not read or copied.
- BB exposes two enabled global MCP servers through its tool directory: Dadabase and Tokitoki. Dadabase advertises saved-connection listing, bounded schema inspection and SQL query tools; Tokitoki advertises usage, session, quota, and report tools. Tool names and schemas were obtained from `mcp_list_tools`; no tool was called for this inventory. DSH's installed `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` supports stdio and Streamable HTTP servers and scrubs inherited key/token/password/secret variables from stdio children. Tokitoki v0.4.0 has a local stdio MCP command (`tokitoki mcp`). No standalone Dadabase endpoint or command is configured in Nixfiles, so that path remains unverified.
- Nixfiles has existing Codex, OpenCodex, AI Accounts, Executor, Tokitoki, and BB plugin setup. Relevant files include `assets/codex/config.template.toml`, `assets/opencodex/config.template.json`, `assets/ai-accounts/seed.mjs`, `assets/executor/`, and the Home Manager modules. They are configuration clues only; no credential values were inspected. Nixfiles also has unrelated dirty AI-account edits in another JJ workspace, preserved during this migration.
- The BB plugin source directory `~/dev/bb-plugins` contains local implementations for AI Accounts, Auto Handoff Parent, Diff Viewed, Jujutsu, MCP Manager, Memory Watch, Preserve Child Threads, Secret Catalog, Settings Search, Sidebar Commands, Sidebar Resize, and Tokitoki Usage. These names are verified from the directory listing; their source is not copied or used for DSH replacements.

### Installed BB plugins

`replicated` means the replacement has been implemented and behavior verified; `partial` means only a subset is verified; `not replicated` means no replacement has been implemented yet. This initial table intentionally marks every in-scope row `not replicated`.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| `action-topbar` | Community plugin, v0.1.0, running, app bundle; mirrors thread tabs and launcher | Platform boundary: DSH custom thread-topbar UI not verified | not replicated | UI behavior from registry description |
| `agent-annotations` | BB built-in v0.1.0, running, app and thread mention; browser element comments | Platform boundary: no equivalent browser-tab annotation surface verified | not replicated | Tool/skill offered by BB plugin |
| `ai-accounts` | Local path plugin v0.1.0, running, UI, service, six provider IDs | Partial owned DSH provider/config work; subscription login and account isolation require exact supported API | not replicated | Do not copy BB or Codex credentials; inspect only safe account metadata |
| `ask-user-question` | BB built-in v0.1.0, running, agent tool | Owned DSH core configuration/tool behavior | not replicated | DSH base includes user-question support |
| `automations` | BB built-in v0.1.0, running, schedule UI/service | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `bb-guide` | BB built-in v0.1.0, running; skills and onboarding | Owned DSH instructions/configuration | not replicated | Include only DSH-relevant instructions |
| `bb-sidebar` | Community plugin v0.2.26, running; sort, snooze, settle | Platform boundary: BB sidebar organization UI | not replicated | No DSH UI slot verified |
| `chat-search` | Community plugin v0.1.3, running, app bundle | Partial owned session-search command/plugin if DSH session query API allows | not replicated | Search scope needs to match BB open-chat search |
| `chatgpt-skin` | Community plugin v0.1.5, running, theme registration | Platform boundary: DSH web theme extension not verified | not replicated | BB custom theme is verified active registry metadata |
| `command-code` | Community plugin v0.1.2, running; ACP provider | Owned provider integration only if installed DSH APIs support the needed transport | not replicated | API-key billing must not replace existing auth silently |
| `concurrency-limit` | BB built-in v0.1.0, running; concurrency controls | Partial owned DSH configuration | not replicated | DSH agent/subagent concurrency knobs need verification |
| `connect` | BB built-in v0.1.0, running; remote access | Platform boundary or owned deployment config, pending DSH listener/auth API | not replicated | Do not expose DSH remotely during this migration |
| `custom-instructions` | BB built-in v0.1.0, running; persistent task instructions | Owned DSH instructions/configuration | not replicated | Keep secrets and unrelated BB instructions out |
| `diff-viewed` | Local plugin v0.1.2, running, app bundle | Platform boundary: custom per-file diff UI not verified | not replicated | |
| `environment-git-worktree` | BB built-in v0.1.0, running; isolated worktree provider | Partial owned workspace launcher/configuration | not replicated | DSH workspace sandbox exists; worktree lifecycle parity unverified |
| `environment-personal-workspace` | BB built-in v0.1.0, running; personal workspace provider | Partial owned workspace configuration | not replicated | Per-thread workspace behavior unverified |
| `environment-project-checkout` | BB built-in v0.1.0, running; checkout provider | Partial owned workspace configuration | not replicated | Branch/checkout selection parity unverified |
| `fast-split` | Community plugin v0.1.0, running, app bundle | Platform boundary: neighboring thread panes | not replicated | |
| `files-editor` | Community plugin v0.1.6, running, app bundle and skill; tree/search/editor | Partial owned DSH core filesystem/search configuration | not replicated | Editing UI parity is unverified |
| `handoff` | Community plugin v0.7.2, running, app bundle and skill; session/provider/machine handoff | Partial owned DSH commands if supported import/export interfaces exist | not replicated | Cross-provider session continuity may be a platform boundary |
| `hotspot` | Community plugin v0.1.0, running; tools and skill | Owned diagnostic command only if DSH can use safe host metadata | not replicated | Do not poll; do not claim per-plugin attribution without evidence |
| `inline-vis` | BB built-in v0.1.0, running; inline HTML/Markdown renderer | Platform boundary: inline assistant-message rendering | not replicated | |
| `jujutsu` | Local plugin v0.1.0, running; CLI and skill | Owned DSH skill/commands using the installed `jj` CLI | not replicated | No BB source reuse |
| `keep-awake` | BB built-in v0.1.0, running; macOS awake behavior | Owned opt-in command/config if supported | not replicated | Never keep awake by default |
| `mcp-manager` | Local plugin v0.1.0, running; MCP server management/tools | Partial owned DSH MCP bridge if DSH plugin APIs permit it | not replicated | Only Dadabase/Tokitoki metadata was inventoried; no credentials copied |
| `memory` | Community plugin v0.2.0, running; durable provider-independent memory | Partial owned DSH memory instructions/storage | not replicated | Cross-provider search and attribution need an owned implementation |
| `memory-watch` | Local plugin v0.1.0, running; host/plugin memory diagnostics | Owned opt-in, bounded host diagnostic if safe APIs permit | not replicated | Avoid polling |
| `message-timestamps` | Community plugin v0.1.0, running, app bundle | Platform boundary unless DSH timeline exposes timestamp formatting | not replicated | |
| `monaco-editor` | BB built-in v0.1.0, running; editor replacement | Platform boundary: DSH editor component integration | not replicated | |
| `navigation` | BB built-in v0.1.0, running; sidebar destinations | Platform boundary: DSH navigation UI | not replicated | |
| `pdf-preview` | BB built-in v0.1.0, running; PDF viewer | Partial owned filesystem/document workflow | not replicated | Native PDF preview UI parity unverified |
| `plugin-api-docs` | BB built-in v0.1.0, running; API browser/mention | Owned DSH development notes from installed API docs | not replicated | Do not port BB API docs/source |
| `plugin-api-tester` | BB built-in v0.1.0, running; test plugin APIs | Owned DSH smoke command/fixture if API is documented | not replicated | |
| `preserve-child-threads` | Local plugin v0.1.0, running; archive lifecycle and thread linking | Platform boundary: DSH thread-tree lifecycle UI/API not verified | not replicated | |
| `provider-acp` | BB built-in v0.1.0, running; Cursor and OpenCode ACP providers | Owned provider integration if DSH APIs support ACP | not replicated | Installed metadata lists Cursor and OpenCode |
| `provider-claude-code` | BB built-in v0.1.0, running; Claude CLI provider | Owned provider adapter if supported DSH interface exists | not replicated | Native CLI login remains host-local |
| `provider-codex` | BB built-in v0.1.0, running; Codex provider | Partial owned adapter; subscription-backed Codex login is a gating boundary | not replicated | No credential copying; do not switch to API billing |
| `provider-pi` | BB built-in v0.1.0, running; Pi provider | Owned adapter only if supported DSH interface exists | not replicated | |
| `provider-retry` | BB built-in v0.1.0, running; retry after overload/reset | Partial owned DSH retry configuration | not replicated | DSH retry policy exists; subscription-reset behavior unverified |
| `provider-usage` | BB built-in v0.1.0, running; usage settings/sidebar | Partial owned Tokitoki integration | not replicated | DSH token meter is not automatically BB provider usage parity |
| `push-notifications` | BB built-in v0.1.0, running; mobile/web/desktop notifications | Platform boundary: notification clients not verified in DSH | not replicated | |
| `scheduled-send` | BB built-in v0.1.0, running; delayed composer send | Platform boundary or owned command, pending DSH web composer API | not replicated | Distinct from deferred Automations |
| `secret-catalog` | Local plugin v0.1.0, running; safe alias listing and scoped reads | Owned DSH integration with the existing local `secret` CLI | not replicated | Secret values only retrieved for a concrete need; never logged or copied |
| `secrets` | BB built-in v0.1.0, running; secure credential request and dotenv reconciliation | Partial owned DSH instruction/tool workflow | not replicated | User interaction may remain necessary |
| `settings-search` | Local plugin v0.1.0, running; indexed settings filter/navigation | Platform boundary: DSH settings search API/UI not verified | not replicated | |
| `side-chat` | BB built-in v0.1.0, running; hidden conversation forks | Platform boundary: DSH side-chat UI | not replicated | |
| `sidebar-commands` | Local plugin v0.1.0, running; plugin page command palette | Platform boundary: DSH app command palette registration | not replicated | |
| `sidebar-resize` | Local plugin v0.1.0, running; resizable sidebar panes | Platform boundary: DSH layout customization API | not replicated | |
| `simple-notes` | Community plugin v0.2.3, running; collaborative Markdown docs and undo | Partial owned filesystem/document workflow | not replicated | BB-specific approvals/undo are not assumed replicated |
| `tasks` | Community plugin v0.1.2, running; task planning/delegation and mention integration | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `tokitoki-usage` | Local plugin v0.1.0, running; Tokitoki usage surface | Owned DSH Tokitoki CLI/MCP integration | not replicated | Verify read-only queries without changing Tokitoki data |
| `usage` | Community plugin v0.3.18, running; cross-machine coding-agent usage/cost | Partial owned DSH usage reporting | not replicated | Pricing/account coverage needs verification |

Disabled installed plugins, recorded for completeness: `account-pool`, `agent-graph`, `agent-tools`, `auto-handoff-parent`, `drafts`, `prompts`, `tabs`, `thread-list`, `traces`, and `workflows`. They are not treated as enabled capabilities and are not migration targets.

### Other material BB settings and integrations

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Providers and models | BB provider registry includes Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, and AI Accounts profiles; permission modes are provider-specific | Owned DSH profile/provider config where supported; Codex subscription auth needs direct verification | not replicated | Provider `available` is metadata, not an auth check |
| Codex subscription accounts | AI Accounts exposes three Codex profiles, with ChatGPT sign-in flow in its metadata | Platform boundary pending a supported DSH OAuth/ACP bridge using the existing host login | not replicated | No copying `~/.codex` auth state and no API-key substitution |
| OpenCode Go accounts | AI Accounts exposes three named profiles; Nixfiles/OpenCodex references environment-based keys | Partial owned config only if account isolation and secret sourcing are supported | not replicated | Only variable names may be referenced; do not read values |
| Skills and agent instructions | BB built-ins, installed skills, global instructions from `~/.agents`, Codex project instructions | Owned DSH instructions/skills for relevant workflows | not replicated | Avoid bulk copying unrelated provider-specific instructions |
| MCP servers | BB MCP Manager; two enabled servers: Dadabase and Tokitoki | Owned DSH MCP client/plugin if the installed APIs support tool registration and scoped auth | not replicated | No server credentials or configs copied |
| Browser and terminal | BB browser control plus persistent scoped terminals | Partial DSH web/search/bash tools | not replicated | DSH browser automation and persistent terminal parity unverified |
| Git integration | BB project/environment and Git worktree providers; Nixfiles agent guidance prefers JJ | Owned instructions/commands using host VCS CLIs | not replicated | Preserve actual repository environment and JJ workspaces |
| Planning and persistence | BB provider plan/goal actions, fork/rewind capability varies; BB stores sessions locally | Owned DSH plan, goal, subagent, and session configuration | not replicated | Base bundle has plan, goals, subagents, and JSONL persistence |
| Permissions and approvals | BB provider permission modes include `accept-edits`, `auto`, and `full` for Codex/Claude; narrower modes for ACP/Pi | Owned DSH sandbox/approval configuration | not replicated | DSH base defaults to workspace-write; test in disposable workspace |
| UI, keybindings, themes | BB has server-synced UI settings, plugins, and custom ChatGPT theme | Platform boundary pending documented DSH UI APIs | not replicated | Do not count a visually similar stock screen as parity |
| Hooks, commands, prompts | Plugin CLI commands and contributed skills are reported by BB plugin metadata; `prompts` plugin is disabled | Owned DSH commands/skills for useful enabled workflows | not replicated | Disabled `prompts` is not a target |
| Shell and files | BB host integrations plus file/editor plugins | Owned DSH base tools and explicit sandbox/approval policy | not replicated | Smoke-test shell and file edits only in disposable locations |

## Initial mapping and implementation plan

DSH v0.2.0-rc.2's installed `@deepseek-ai/dsh-base` bundle documents supported plugin composition and includes first-party DSH plugins for agent tools, Bash sandboxing, filesystem access/search, plan mode, questions, subagents, skills, JSONL session persistence, web search/fetch, local jobs, token metering, and retry. These are platform APIs, not replacements by DSH Market. The current `web` profile also includes DSH Market; the migration will use a separate profile derived from the shipped web profile and exclude that dependency.

The initial mapping above was written before changing the installed DSH profiles. It reflects BB registry metadata, local Nix configuration, safe provider metadata, and installed DSH package declarations. Capability descriptions are certain at the registry/configuration level; behavior is marked verified only where a live action or a source implementation was inspected.

### Parked workflow requirements

The user identified these additional BB shortcomings in parked threads. They are product requirements for the DSH migration, not optional polish:

| Workflow | Required DSH behavior | Initial feasibility assessment |
|---|---|---|
| Switch provider/account in one visible conversation | Keep the same timeline and let the next turn use another provider or isolated account without requiring a fork or handoff. The implementation may create a provider-native session internally, but must preserve the user's single conversation view and explicit context continuity. | Must inspect DSH session and provider lifecycle APIs. If a thread cannot change agent/provider through supported APIs, record that exact boundary and implement the closest owned continuity layer without pretending it is the same provider-native session. |
| Change project/workspace in one visible conversation | Let the next turn run in a selected project/workspace while retaining the same timeline and prior conversation. Never silently move or rewrite existing files. | Must inspect the DSH workspace controller and per-turn working-directory APIs. The new directory applies to future work only. |
| Send later and New thread | Provide delayed-send behavior without covering, disabling, or trapping the New thread action. If the web app does not expose a supported composer extension point, document that boundary rather than patching DSH core. | Must inspect supported composer hooks and UI slots. |
| Codex provider and AI Accounts | Preserve the distinction between direct Codex subscription login and named isolated Codex/OpenCode Go profiles. Try Codex ACP at GPT-6-Luna only. If its login requires user interaction, continue the OpenCode Go ACP check when its existing subscription auth can be used. | Use DSH's supported ACP and account/profile interfaces. Never copy BB/Codex auth files or substitute API-key billing. |

### Implementation sequence

1. Complete targeted read-only inspection of installed DSH plugin APIs, BB provider/model metadata, safe auth-method status, and relevant Nixfiles references. No DSH profile changes before this initial inventory and mapping are recorded.
2. Use `~/dev/dsh-plugins` as the owned JJ source repository and create focused packages against installed DSH's supported Cordis/profile APIs. Do not install DSH Market or use third-party plugin source.
3. Use a dedicated DSH profile and a Nixfiles-owned desktop launcher. Preserve the stock `web` and `desktop` profiles and the current DSH listener.
4. First implement useful portable behavior: relevant instructions/skills, safe Secret CLI metadata access, Jujutsu/repository workflows, bounded Tokitoki reads, model/provider configuration, and explicit sandbox/approval defaults.
5. Verify startup, plugin loading, safe provider/auth status, shell and file actions in a disposable directory, MCP calls, and supported ACP workflows. Never test by editing existing repositories; only attempt Codex with GPT-6-Luna.
6. Update each inventory row and record concrete verification, platform gaps, required user actions, normal-use commands, and rollback/removal steps. Do not alter BB, DSH stock profiles, global package versions, or unrelated Nix inputs.
