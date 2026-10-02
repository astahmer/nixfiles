# BB to DSH migration

This is the versioned migration record and source-of-truth plan for a first-party DSH setup. It is also exposed from `$DSH_HOME/BB-MIGRATION.md`. BB is left installed and unchanged. The owned BB AI Accounts plugin was inspected as the behavior source; its code is not copied into DSH or imported at runtime. No DSH Market package or third-party DSH plugin is used by the migration profile.

## Discovery snapshot

Checked 2026-10-02 on Apple Silicon macOS.

- BB CLI: `0.44.0`; local data directory: `~/.bb`; current project: `nixfiles`; active plugin service reports no plugins needing attention.
- BB plugin registry: 62 installed; 47 enabled and running; 15 disabled. Disabled plugins are out of migration scope and are omitted from the capability table. Tasks and Automations are enabled but explicitly deferred. Inventory below is from `bb plugin list --json`, which reports versions, source/provenance, running status, frontend bundles, service/schedule declarations, and contributed capabilities. Descriptions and status are verified registry metadata; underlying behavior is not source-audited unless explicitly called out.
- DSH CLI/package: `@deepseek-ai/dsh@0.2.0-rc.2`; Node `v24.20.0`; `DSH_HOME` is unset and the active home is `~/.dsh`.
- Installed DSH profiles: `web` and `desktop`. The existing `web` profile has `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `dshmarket` in its bundle list; its own package dependency is `dshmarket@^1.66.7`. Its local patch sets only a UI welcome-notice version. Its `cordis.yml` is generated output and must not be edited. The requested destination is the existing `web` profile, with DSH Market removed from that profile. `desktop` remains untouched.
- The DSH web endpoint at `http://localhost:3080` returned HTTP 401 during one authorized local probe. This proves an HTTP service answered then, not that a browser session or model request is authenticated. A second sandboxed probe could not connect; service availability must be rechecked outside that restriction.
- BB server-backed metadata was queried via the documented BB CLI. Available providers are Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, three Codex account profiles, and three OpenCode Go account profiles. The primary Codex model menu includes GPT-6.1-Sol, GPT-6-Astra/Sol/Luna, GPT-5.6-Sol/Terra/Luna, and GPT-5.5; the `EM · Codex` account defaults to GPT-6-Luna. OpenCode Go account catalogs include DeepSeek V4.1 Flash and Fledge Alpha Free. “Available” is the provider registry state; it does not prove a signed-in session. Provider metadata identifies Codex/Claude/Pi CLI login flows and ChatGPT login for the Codex account plugin. API-key/account secrets were not read or copied.
- BB exposes two enabled global MCP servers through its tool directory: Dadabase and Tokitoki. Dadabase advertises saved-connection listing, bounded schema inspection and SQL query tools; Tokitoki advertises usage, session, quota, and report tools. Tool names and schemas were obtained from `mcp_list_tools`; no tool was called for this inventory.
- Nixfiles has existing Codex, OpenCodex, AI Accounts, Executor, Tokitoki, and BB plugin setup. Relevant files include `assets/codex/config.template.toml`, `assets/opencodex/config.template.json`, `assets/ai-accounts/seed.mjs`, `assets/executor/`, and the Home Manager modules. They are configuration clues only; no credential values were inspected. Nixfiles also has unrelated dirty AI-account edits in another JJ workspace, preserved during this migration.
- The BB plugin source directory `~/dev/bb-plugins` contains local implementations for AI Accounts, Auto Handoff Parent, Diff Viewed, Jujutsu, MCP Manager, Memory Watch, Preserve Child Threads, Secret Catalog, Settings Search, Sidebar Commands, Sidebar Resize, and Tokitoki Usage. These names are verified from the directory listing; their source is not copied or used for DSH replacements.

### Active BB settings

Read from `bb settings show --json`; `customCss` contents and credentials were deliberately excluded from captured output.

- General: keyboard hints on; Enter does not steer an active thread; diagnostics and unhandled-provider events hidden; streamer mode off; telemetry on; managed branch prefix `bb/`; provider order/default unset; no default machine access; machine Git credentials enabled; Connect selected as server-access default but pairing is setup-required and effective URL is unset.
- Appearance: active theme `plugin:chatgpt-skin:chatgpt`; one plugin theme; no standalone custom themes. The active custom CSS is a BB-specific token/UI skin and must be treated as a user setting, not silently discarded.
- UI/input: 109 active keybindings, 3 overrides; voice transcription enabled. Preserve applicable shortcuts and preferences where DSH offers supported configuration; BB-only UI bindings map to platform boundary when DSH has no equivalent.
- Experiments: changelog preview, legacy Jiti loader, mobile app, server move, and sidebar progressive disclosure are off. Feature flags observed: placeholder off and timeline window event budget 1500.
- Providers: Codex, Pi, Cursor ACP, OpenCode ACP, three Codex account homes, and three OpenCode Go account homes are listed. Availability metadata does not prove an authenticated session. Existing subscription-backed homes stay local; no auth files or secret values are copied.
- Skills: BB reports the installed skill registry separately from plugins; only skills/instructions actually used by enabled BB plugins or active user configuration are in scope. Nix-managed `~/.agents/skills` and project instructions are the source candidates; unrelated Codex skills are not migrated wholesale.

### Active settings mapping

| BB setting | DSH replacement | status | notes |
|---|---|---|---|
| Active `plugin:chatgpt-skin:chatgpt` theme and 74,583-character custom CSS | Owned token overlay plus DSH's persisted Dark preference | partial | Fourteen color tokens now match the active BB theme in the live DSH page. BB layout selectors and other CSS remain outside the DSH token contract. |
| Voice transcription enabled | DSH official Voice input enabled; local SenseVoiceSmall INT8 model prepared | partial | DSH reports local speech recognition ready. The Chrome microphone permission and an actual recording/transcription remain unverified; no audio was recorded. |
| 109 active shortcuts; overrides `sidebar.toggle` Command+B, `panel.toggle` Command+Shift+B, `terminal.open` Command+J | DSH shortcut editor | partial | Command+Shift+B already toggles the right sidebar. DSH web editor refused bare Command+B and Command+J as unsupported combinations; remaining bindings were not copied wholesale. |
| Keyboard hints on; Enter does not steer an active thread | DSH keyboard shortcut editor and busy-send preference | partial | DSH exposes its own keybinding list and Queue/Steer behavior; exact parity has not been checked beyond Command+Shift+B. |
| Diagnostic and unhandled-provider events hidden; streamer mode off; telemetry on | DSH settings and plugin configuration | not replicated | DSH settings have no verified equivalents for these BB preferences; DSH's separate official-model session-log upload setting is on by default and is not treated as equivalent to BB telemetry. |
| Managed branch prefix `bb/`; default provider/order unset; no default machine access; machine Git credentials enabled | DSH workspace and provider settings | partial | DSH uses local workspace access; there is no verified equivalent for BB machine-provider defaults or branch naming policy. Provider/account routes are documented separately. |
| Connect selected as BB server-access default, pairing setup-required, no effective URL | DSH local loopback web listener on port 3080 | partial | No remote listener or Connect replacement is enabled. |
| BB experiments off; timeline event budget 1500 | DSH core defaults | partial | Experiments remain off. The BB timeline event budget has no verified DSH setting. |

### Enabled BB plugins

`replicated` means the replacement has been implemented and behavior verified; `partial` means only a subset is implemented or verified; `not replicated` means no replacement has been implemented. The table was recorded before changing DSH; statuses are updated below as verification completes.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| `action-topbar` | Community plugin, v0.1.0, running, app bundle; mirrors thread tabs and launcher | Platform boundary: DSH custom thread-topbar UI not verified | not replicated | UI behavior from registry description |
| `agent-annotations` | BB built-in v0.1.0, running, app and thread mention; browser element comments | Platform boundary: no equivalent browser-tab annotation surface verified | not replicated | Tool/skill offered by BB plugin |
| `ai-accounts` | Local path plugin v0.1.0, running, UI/service; six provider IDs, including three isolated Codex homes | Owned DSH ACP LLM adapter exposes six routes in `/model` | partial | The live route directory lists all six owned routes alongside built-in providers. `codex-personal` completed a Luna turn. Selecting `opencode-go-alex` on a fresh session started generation but received no response after 1m35s; it was stopped. The OpenCode Go account has existing auth metadata; account editor, quota history and provider-side session reuse are not replicated. |
| `ask-user-question` | BB built-in v0.1.0, running, agent tool | First-party DSH user-question tool in standard preset | partial | Present in the active preset. The ACP account adapter does not pass DSH tools into the ACP agent; a DSH-native model round trip is not verified because the built-in Codex provider is unconfigured. |
| `automations` | BB built-in v0.1.0, running, schedule UI/service | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `bb-guide` | BB built-in v0.1.0, running; skills and onboarding | DSH agent instructions plus filesystem skills | partial | Uses Nix-managed `~/.agents/skills`; prompt injection behavior not independently runtime-tested |
| `bb-sidebar` | Community plugin v0.2.26, running; sort, snooze, settle | Platform boundary: BB sidebar organization UI | not replicated | No DSH UI slot verified |
| `chat-search` | Community plugin v0.1.3, running, app bundle | Partial owned session-search command/plugin if DSH session query API allows | not replicated | Search scope needs to match BB open-chat search |
| `chatgpt-skin` | Community plugin v0.1.5, running, theme registration | Owned DSH plugin `@astahmer/dsh-bb-chatgpt-theme` | partial | DSH plugin panel shows it installed and enabled. Fourteen mapped color tokens now match the active BB theme in dark mode; matching the full 74 KB BB CSS is outside the token mapping so far. |
| `concurrency-limit` | BB built-in v0.1.0, running; concurrency controls | Partial owned DSH configuration | not replicated | DSH agent/subagent concurrency knobs need verification |
| `connect` | BB built-in v0.1.0, running; remote access | Platform boundary or owned deployment config, pending DSH listener/auth API | not replicated | Do not expose DSH remotely during this migration |
| `custom-instructions` | BB built-in v0.1.0, running; persistent task instructions | DSH agent-instructions plugin in the standard preset | partial | Configured in the active preset; exact instruction-file discovery and precedence remain unverified. Fresh DSH sessions now open without the duplicate persona error. |
| `diff-viewed` | Local plugin v0.1.2, running, app bundle | Platform boundary: custom per-file diff UI not verified | not replicated | |
| `environment-git-worktree` | BB built-in v0.1.0, running; isolated worktree provider | Partial owned workspace launcher/configuration | not replicated | DSH workspace sandbox exists; worktree lifecycle parity unverified |
| `environment-personal-workspace` | BB built-in v0.1.0, running; personal workspace provider | Partial owned workspace configuration | not replicated | Per-thread workspace behavior unverified |
| `environment-project-checkout` | BB built-in v0.1.0, running; checkout provider | Partial owned workspace configuration | not replicated | Branch/checkout selection parity unverified |
| `fast-split` | Community plugin v0.1.0, running, app bundle | Platform boundary: neighboring thread panes | not replicated | |
| `files-editor` | Community plugin v0.1.6, running, app bundle and skill; tree/search/editor | DSH filesystem tools and shell in the standard preset | partial | A Luna session and shell write/readback in `/private/tmp/dsh-migration-smoke` succeeded. The ACP route did not expose DSH filesystem tools, so native DSH filesystem tool use and BB tree/editor UI are not replicated. |
| `handoff` | Community plugin v0.7.2, running, app bundle and skill; session/provider/machine handoff | Partial owned DSH commands if supported import/export interfaces exist | not replicated | Cross-provider session continuity may be a platform boundary |
| `hotspot` | Community plugin v0.1.0, running; tools and skill | Owned diagnostic command only if DSH can use safe host metadata | not replicated | Do not poll; do not claim per-plugin attribution without evidence |
| `inline-vis` | BB built-in v0.1.0, running; inline HTML/Markdown renderer | Platform boundary: inline assistant-message rendering | not replicated | |
| `jujutsu` | Local plugin v0.1.0, running; CLI and skill | Host `jj` CLI through DSH Bash plus the existing Jujutsu skill | partial | Host command and skill are available; session blocker prevented DSH-mediated verification. |
| `keep-awake` | BB built-in v0.1.0, running; macOS awake behavior | Owned opt-in command/config if supported | not replicated | Never keep awake by default |
| `mcp-manager` | Local plugin v0.1.0, running; MCP server management/tools | DSH first-party MCP client plus owned ACP adapter passes local Tokitoki to account sessions | partial | Luna invoked Tokitoki `budgets_status` successfully with values suppressed. Dadabase has no independently launchable endpoint/command in the inspected host config; server management UI and Dadabase tools remain gaps. |
| `memory` | Community plugin v0.2.0, running; durable provider-independent memory | Partial owned DSH memory instructions/storage | not replicated | Cross-provider search and attribution need an owned implementation |
| `memory-watch` | Local plugin v0.1.0, running; host/plugin memory diagnostics | Owned opt-in, bounded host diagnostic if safe APIs permit | not replicated | Avoid polling |
| `message-timestamps` | Community plugin v0.1.0, running, app bundle | Platform boundary unless DSH timeline exposes timestamp formatting | not replicated | |
| `monaco-editor` | BB built-in v0.1.0, running; editor replacement | Platform boundary: DSH editor component integration | not replicated | |
| `navigation` | BB built-in v0.1.0, running; sidebar destinations | Platform boundary: DSH navigation UI | not replicated | |
| `pdf-preview` | BB built-in v0.1.0, running; PDF viewer | DSH filesystem workflow | partial | File access only; preview UI not replicated |
| `plugin-api-docs` | BB built-in v0.1.0, running; API browser/mention | Owned DSH development notes from installed API docs | not replicated | Do not port BB API docs/source |
| `plugin-api-tester` | BB built-in v0.1.0, running; test plugin APIs | Owned DSH smoke command/fixture if API is documented | not replicated | |
| `preserve-child-threads` | Local plugin v0.1.0, running; archive lifecycle and thread linking | Platform boundary: DSH thread-tree lifecycle UI/API not verified | not replicated | |
| `provider-acp` | BB built-in v0.1.0, running; Cursor and OpenCode ACP providers | Owned ACP LLM adapter for the available Codex and OpenCode Go account homes | partial | The active `/model` directory lists Codex and OpenCode Go routes. The Codex Luna round trip passed; the OpenCode Go target-model turn remained pending. Cursor account route is not configured. |
| `provider-codex` | BB built-in v0.1.0, running; Codex provider | Owned DSH ACP account adapter launches Codex with existing `CODEX_HOME` | partial | Active DSH `codex-personal`/`gpt-6-luna` session completed a model turn. No credential copy, Sol request, or API-key billing. |
| `provider-pi` | BB built-in v0.1.0, running; Pi provider | Owned adapter only if supported DSH interface exists | not replicated | |
| `provider-retry` | BB built-in v0.1.0, running; retry after overload/reset | DSH first-party retry plugin | partial | Generic retry exists; account reset-specific retry behavior is not verified |
| `push-notifications` | BB built-in v0.1.0, running; mobile/web/desktop notifications | Platform boundary: notification clients not verified in DSH | not replicated | |
| `scheduled-send` | BB built-in v0.1.0, running; delayed composer send | No owned DSH composer implementation | not replicated | Same-timeline composer control remains outstanding and is distinct from deferred Automations. |
| `secret-catalog` | Local plugin v0.1.0, running; safe alias listing and scoped reads | Existing host `secret-cli` skill available to DSH | partial | No secret values were read; alias listing was not runtime-tested |
| `secrets` | BB built-in v0.1.0, running; secure credential request and dotenv reconciliation | Partial owned DSH instruction/tool workflow | not replicated | User interaction may remain necessary |
| `settings-search` | Local plugin v0.1.0, running; indexed settings filter/navigation | Platform boundary: DSH settings search API/UI not verified | not replicated | |
| `side-chat` | BB built-in v0.1.0, running; hidden conversation forks | Platform boundary: DSH side-chat UI | not replicated | |
| `sidebar-commands` | Local plugin v0.1.0, running; plugin page command palette | Platform boundary: DSH app command palette registration | not replicated | |
| `sidebar-resize` | Local plugin v0.1.0, running; resizable sidebar panes | Platform boundary: DSH layout customization API | not replicated | |
| `simple-notes` | Community plugin v0.2.3, running; collaborative Markdown docs and undo | DSH filesystem editing | partial | Editing is available; collaborative undo and approvals are not replicated |
| `tasks` | Community plugin v0.1.2, running; task planning/delegation and mention integration | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `tokitoki-usage` | Local plugin v0.1.0, running; Tokitoki usage surface | Isolated `bb-migration` profile uses DSH MCP client (`tokitoki mcp`); web profile uses `@astahmer/dsh-tokitoki-usage` cached quota-summary command | partial | Direct MCP handshake and read-only call passed; DSH agent tool call is blocked by session creation. Web profile wiring and live composer registration verified; command output was not invoked to avoid exposing quota values; edge badge, popover, provider marks, and minute polling remain DSH UI boundaries. |
| `usage` | Community plugin v0.3.18, running; cross-machine coding-agent usage/cost | Partial owned DSH usage reporting | not replicated | Pricing/account coverage needs verification |

### Implementation and verification update

The active target is the existing `~/.dsh/profiles/web`, built from the installed DSH base and web-app bundles. Its manifest now excludes DSH Market and includes the owned account adapter plus exact-version DSH ACP/MCP dependencies. The default route is `codex-personal` at `gpt-6-luna`; the model menu defines three Codex homes fixed to Luna and three OpenCode Go homes pinned to `opencode-go/deepseek-v4.1-flash`.

The adapter is in `~/dev/dsh-plugins/packages/acp-accounts`. It uses DSH's `LlmAdapter`, `SessionStore`, managed subprocess service, and ACP SDK 1.5.1. It replays the visible DSH session transcript into a fresh ACP session each turn, so provider selection is designed to keep the same DSH timeline. It does not retain provider-side process state, pass images, or bridge ACP permission requests; those are cancelled. It reads the account homes in place and never copies or prints their credential files. Its Codex ACP executable path now points to `~/.dsh/profiles/web`.

OpenCode's official configuration supports `OPENCODE_CONFIG_CONTENT` as an inline runtime override, and ACP's model choice normally changes on the session. In the installed OpenCode 1.18.33 environment, the direct ACP selection path stalled, so the owned adapter sets the desired model at process start instead. The target model becomes selected, but its generation still does not return. See [OpenCode configuration](https://dev.opencode.ai/docs/config/) and [OpenCode ACP](https://opencode.ai/v2/docs/cli/acp/).

The earlier duplicate `deployment:persona-prefix` failure was caused by multiple active agent presets registering the same section. The active web patch removes `persona` from the standard preset and disables the other bundled presets implicated in the collision. After restart, Chrome opened a fresh session without the error.

A direct ACP smoke prompt using the existing personal Codex home completed with `gpt-6-luna`. No login prompt appeared, no API key was used, and no credentials were copied. `opencode auth list` showed an OpenCode Go credential in the existing Alex account home without exposing its value. A direct ACP request on that profile's unspecified default returned, but the requested `opencode-go/deepseek-v4.1-flash` model remained pending both directly and in the DSH UI. The supported `OPENCODE_CONFIG_CONTENT` override selects the target model; generation on that target remains unverified.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| `ask-user-question` | Built-in agent question tool | First-party DSH user-question tool in standard preset | partial | Present in installed composition; interactive round trip not exercised |
| `bb-guide` | Built-in onboarding and skills | DSH agent instructions plus filesystem skills | partial | Uses Nix-managed `~/.agents/skills`; prompt injection behavior not independently runtime-tested |
| `custom-instructions` | Built-in persistent project/task instructions | DSH agent-instructions plugin | partial | Reads applicable instruction files; exact precedence differs from BB and needs user review |
| `files-editor` | BB file editor/tree/search UI | DSH filesystem and search tools in standard preset | partial | Tool APIs are present; disposable read/write smoke test remains |
| `jujutsu` | Local BB plugin commands and skill | Host `jj` CLI through DSH Bash plus existing Jujutsu skill | partial | Skill is discoverable; no repository mutation was tested |
| `mcp-manager` | BB MCP registry and manager | DSH first-party MCP client configured for local Tokitoki | partial | Configured and profile starts; tool discovery/call remains unverified. Dadabase has no confirmed DSH-reachable endpoint |
| `pdf-preview` | BB PDF preview UI | DSH filesystem workflow | partial | File access only; preview UI not replicated |
| `provider-retry` | BB provider retry policy | DSH first-party retry plugin | partial | Generic retry exists; account reset-specific retry behavior is not verified |
| `secret-catalog` | Local BB plugin backed by `secret` CLI | Existing host `secret-cli` skill available to DSH | partial | No secret values were read; alias listing was not runtime-tested |
| `simple-notes` | BB collaborative Markdown editor | DSH filesystem editing | partial | Editing is available; collaborative undo and approvals are not replicated |
| `tokitoki-usage` | Local BB plugin backed by Tokitoki | Isolated profile: first-party DSH MCP client (`tokitoki mcp`); web profile: `@astahmer/dsh-tokitoki-usage` cached quota-summary command | partial | Direct MCP handshake and read-only call passed; DSH agent tool call is blocked by session creation. Web profile wiring and live composer registration verified. Command output was not invoked to avoid exposing quota values; edge badge, popover, provider marks, and minute polling remain DSH UI boundaries. |
| `ai-accounts` and provider plugins | BB provider registry and account-switch UI | Owned DSH ACP account choices over the first-party subagent API; default model is configured separately | partial | Codex choices delegate one fresh child turn per call; persistent provider sessions, model catalog controls, and usage history remain gaps. Codex ACP run is not exercised pending user auth and per instruction no model/token call |
| Tasks and Automations | Enabled BB plugins | None | deferred | Explicitly out of scope |

Earlier, the isolated `bb-migration` launcher selected Node `v22.23.3`, port 3081, and DSH's one-time browser token. The authenticated UI loaded in Chrome, and that dedicated process was stopped after checks. The current single-profile launcher is `assets/dsh/start-dsh` and targets port 3080, matching the installed Chrome app named DeepSeek Harness. The web profile started successfully; an unauthenticated request to `/` returned HTTP 401, confirming the local server answered and enforced token access. The authenticated page itself was not opened during this check.

The current BB plugin inventory is from `bb plugin list --json`: 62 installed, 47 enabled and running, 15 disabled. Only the 47 enabled plugins appear in the mapping table. Disabled plugins are out of scope; Tasks and Automations remain deferred despite being enabled.

### Other material BB settings and integrations

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Providers and models | Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, and six AI Accounts routes | DSH native Pi AI providers plus owned ACP account LLM adapter | partial | `/model` lists the six owned routes plus built-in providers, and provider selection works on the existing timeline. `codex-personal`/GPT-6-Luna passed; OpenCode Go target-model generation hangs. DSH's built-in `openai-codex` provider is listed but returned `Provider is not configured`; native Codex sign-in is a separate user-interaction step. Pi, Claude Code, Cursor ACP and the remaining account homes still need verification or implementation. |
| Codex subscription accounts | Three named `CODEX_HOME` profiles managed by BB AI Accounts | Owned `codex-personal`, `codex-work`, and `codex-alex2` routes, each fixed to Luna | partial | `codex-personal` completed a DSH UI turn using `gpt-6-luna`; the other two account homes are listed but not generation-tested. No credentials copied or API-key billing used. |
| OpenCode Go accounts | Three named profiles isolated by `XDG_DATA_HOME` | Owned `opencode-go-alex`, `opencode-go-manu`, and `opencode-go-mathias` routes | partial | All three routes appear in `/model`. `opencode auth list` on the Alex profile reports an OpenCode Go credential without exposing values. A direct ACP turn using the profile's unspecified default returned; pinning the requested `opencode-go/deepseek-v4.1-flash` target through documented `OPENCODE_CONFIG_CONTENT` selected that model, but both direct and DSH target-model turns remained pending. No login prompt appeared and no auth values were read. |
| Skills and agent instructions | BB registry, Nix-managed user skills and project instructions | DSH standard preset's instruction and filesystem-skill plugins | partial | Configured in the active composition. User skill discovery and precedence remain unverified. |
| MCP servers | BB MCP Manager; Dadabase and Tokitoki | DSH first-party MCP client; Tokitoki stdio configured | partial | Luna invoked Tokitoki `budgets_status` through the owned ACP route and reported success with values suppressed. Dadabase's standalone endpoint/command is not present in inspected config. |
| Shell and files | BB host shell, file tools and editor | DSH first-party Bash, filesystem edit and search tools | partial | Standard preset composition is verified; agent-mediated disposable file smoke test is blocked by session creation. |
| Git and JJ | BB environment providers and Jujutsu plugin | Host `jj` CLI, DSH workspace selection and existing Jujutsu skill | partial | No DSH worktree lifecycle parity; no existing repository was changed by this migration. |
| Browser and terminal | BB browser tools and scoped persistent terminals | DSH web search/fetch and shell APIs | partial | Browser DOM control and persistent-terminal parity are not established. |
| Planning and persistence | BB plan, goals, forks/rewind and local sessions | DSH plan/goal tools, subagents and JSONL session storage | partial | APIs/config are present; the active web session flow and cross-provider import/rewind parity remain unverified or unavailable. |
| Permissions and approvals | Provider-specific permission levels and prompts | DSH access presets and approval service | partial | Web profile retains Workspace Write and default approval behavior. ACP permission requests are rejected in the account adapter because no DSH approval bridge is available. |
| Hooks, commands and prompts | BB plugin commands, prompt registry and skills | DSH built-in command and instruction APIs | partial | No owned BB command-palette port; profile behavior is blocked before a session starts. |
| UI, keybindings and theme | BB custom theme, tabs, navigation, annotations and composer plugins | DSH web UI and installed plugin extension points | partial | The DSH UI loads. BB-specific sidebar, thread-topbar, settings search, annotations, diff status, and notification surfaces are not replicated. |
| Secret CLI | BB Secret Catalog and secure credential request flows | Host `secret` CLI remains available to DSH shell/skills | partial | No secret value was requested or read for this migration. Interactive secret capture and BB approval UI are not reproduced. |
| Usage and account meters | BB Provider Usage, Tokitoki and AI Accounts quota history | DSH token metering plus configured Tokitoki MCP client | partial | Token meter is present; account-specific quota history and provider usage visualization are not implemented. |
| Tasks and Automations | BB Tasks and scheduled automation plugins | None | deferred | Explicitly out of scope; no replacement research or implementation. |

## Initial mapping and implementation plan

The initial inventory and mapping were written before DSH profile changes. The implementation order was:

1. Use one DSH profile: the existing `web` profile, remove DSH Market, preserve `desktop` unchanged.
2. Reproduce account selection first with an owned ACP-backed DSH LLM adapter, using existing account homes without moving credentials.
3. Reuse supported DSH core plugins/configuration for shell, files, instructions, skills, planning, session persistence, permissions, MCP, and web tools.
4. Verify the profile start, account authentication, route selection, shell/file operations, MCP, same-session provider changes, and the parked composer/project workflows.
5. Record platform boundaries precisely and update status only from runtime evidence.

Earlier work added the account adapter and an isolated profile, but did not reproduce the enabled BB plugins and settings. The current work first records the corrected scope and mapping, then consolidates the owned configuration into the single `web` profile. Replication remains partial until each behavior is implemented and verified.

## Remaining mapping and gaps

The parked BB threads establish these product requirements:

- `Fix send later breaking the new thread button`: the composer’s delayed-send control must not interfere with starting a new thread.
- `Allow changing the project of an existing thread`: the desired result is one visible conversation timeline while changing provider/account or project; parent-child grouping and handoff do not meet the requirement.
- `Do we need the official Codex plugin if we built`: the official provider and account-management layer have different roles. Keep DSH's normal Codex route available, while the owned account routes use their own existing subscription homes.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Same visible timeline across providers/accounts | BB currently requires handoff for provider/account changes; user wants one timeline | DSH model selection and owned account LLM routes can select a different provider for a DSH session | partial | Live `/model` selection changed the current session to `opencode-go-alex`, so same-timeline selection is verified. Codex Luna generated in DSH; OpenCode Go's pinned target did not finish, so reliable multi-provider continuity remains unverified. |
| Change project/workspace on the same timeline | BB requires a fork/new thread for a project change | DSH lets a new session choose a workspace; existing session header has immutable `cwd` and the installed API exposes no move-session operation | Platform boundary | No supported session rehome/update API was found. A plugin cannot safely change the existing persisted session's working-directory identity. |
| Send later without breaking New Thread | BB scheduled-send composer extension currently interferes with New Thread | No owned DSH composer replacement yet | not replicated | Distinct from deferred Automations. DSH's input-trigger UI extension surface was identified, but an owned delayed-send implementation and round-trip test remain. |
| Account editor and usage history | BB AI Accounts UI manages profiles, catalogs, identity and quota history | Owned fixed account routes in the DSH model picker | partial | Account menu behavior is replicated in configuration; editable profiles, usage meters, account identity display, and session continuity inside ACP processes are not. |
| Dadabase MCP | BB-managed server advertises connection, schema and SQL tools | None | Platform boundary | No independently launchable endpoint/command was found in the inspected host config. DSH can connect to MCP servers, but requires an address or executable. |
| Browser annotations, thread panes, app navigation and visual settings | BB app UI plugins | DSH web UI extension points where installed and documented | not replicated | No API was verified for these specific BB surfaces; a similar default UI is not counted as parity. |
| Codex / OpenCode ACP providers | BB provider bridge supports interactive provider sessions | Owned ACP LLM adapter | partial | DSH UI invoked the Codex Luna route successfully. OpenCode Go route selection worked, but its pinned target-model turn remained pending for 1m35s and was stopped. A direct ACP request on the profile's unspecified default returned; this does not verify the pinned target model. |
| Tasks and Automations | Enabled BB plugins | None | deferred | No investigation or implementation by request. |

## Changes made

- Corrected the enabled-plugin inventory to 47 enabled and 15 disabled, removed disabled plugins from the migration table, and documented active BB settings without copying custom CSS contents or credentials.
- Added `modules/dsh.nix`, wired it into the macOS Home Manager profile, and added a single `web` launcher. Updated the old migration launcher to forward to the single-profile launcher.
- Fixed stale Nix plugin source references: they pointed to missing flake inputs/sibling paths; they now resolve the existing `~/dev/bb-plugins/plugins/<id>` tree at activation time. Home Manager activation was not run because its existing hooks rebuild/install BB plugins, which would change BB during this migration. The full Home Manager activation package and `nix flake check --no-build` now evaluate successfully.
- Earlier work created `~/.dsh/profiles/bb-migration`; this is now a migration staging profile only. This change targets `web` as the single user profile and leaves `desktop` untouched.
- Added exact-version first-party DSH MCP and ACP subagent packages to the active web profile; added the DSH-owned local ACP account adapter from `~/dev/dsh-plugins/packages/acp-accounts`. Updated the adapter executable path to the single `web` profile.
- Added six owned account routes. Codex routes are pinned to GPT-6 Luna and use existing homes; OpenCode Go routes use the existing isolated XDG data roots and the Nix-managed `opencode` command from PATH.
- Bumped `@astahmer/dsh-acp-accounts` to v0.2.0. OpenCode Go routes now set their selected model with the documented `OPENCODE_CONFIG_CONTENT` environment override and skip the ACP model-change request that stalled; this removes the setup stall, but target-model generation still does not return.
- Set the migration profile default to `codex-personal` at `gpt-6-luna`; native `openai-codex` remains a separate optional DSH route and is not the default.
- Earlier staging profile used Tokitoki's local stdio MCP registration and a port 3081 launcher; the active single-profile launcher now targets port 3080.
- Corrected the owned adapter to the installed ACP SDK 1.5.1 `ClientContext.request(...)` API and its select-config request shape.
- Added owned `@astahmer/dsh-bb-chatgpt-theme` using DSH's supported `overrideTokens` API and paired palette values derived only from the active BB theme's color variables; no BB CSS selectors or third-party theme source was copied. Verified the 14 mapped dark tokens in the live page; light values preserve DSH's built-in palette.
- Set DSH appearance to `Dark` through its settings UI. Attempted BB's Command+B sidebar override; the DSH web shortcut editor rejects that bare modifier combination. Command+Shift+B already maps to the right-sidebar action; Command+J remains unsupported in the web editor.
- Enabled DSH Voice input and downloaded/prepared the official local SenseVoiceSmall INT8 model. DSH reports local recognition ready; no microphone permission was granted and no audio was recorded.
- Verified active-profile Luna session creation and a Luna model turn. A shell-based disposable file write/readback passed. The owned ACP adapter now passes the existing local Tokitoki MCP server through ACP's supported `mcpServers` session setup; Luna's `budgets_status` tool call succeeded with values suppressed.
- No BB settings, plugins, servers, credentials, or unrelated Nix configuration were changed. No DSH, BB, or unrelated package was upgraded. No DSH Market plugin is used by the migration profile.

## Owned DSH plugins

| Plugin | Purpose and architecture | Permission boundary | Status |
|---|---|---|---|
| `@astahmer/dsh-acp-accounts` (`~/dev/dsh-plugins/packages/acp-accounts`, v0.2.0) | DSH `LlmAdapter` starts one ACP process per turn for six isolated Codex/OpenCode Go account routes. It forwards the current DSH transcript as text, passes local Tokitoki through ACP's standard `mcpServers` field, and sets the fixed OpenCode route model through `OPENCODE_CONFIG_CONTENT`. | Uses existing account homes without reading/copying credentials. ACP permission requests are cancelled. DSH-native filesystem tools are not forwarded into the ACP agent. | Luna route and Tokitoki MCP call verified. OpenCode Go target-model generation remains pending; other account routes, image input and interactive permission approval remain gaps. |
| `@astahmer/dsh-bb-chatgpt-theme` (`~/dev/dsh-plugins/packages/bb-chatgpt-theme`, v0.1.0) | Browser client plugin overlays 14 selected BB color values via `ctx.theme.overrideTokens`; light mode preserves DSH's stock colors. | Theme tokens only; no filesystem, shell, network, or credential access. | Dark palette tokens match live DSH after reload. Full BB CSS layout rules and complete palette are not ported. |

## Verification performed

| Check | Result |
|---|---|
| BB enabled plugin inventory | Passed via `bb plugin list --json`: 62 installed, 47 enabled/running, 15 disabled. Disabled plugin rows are omitted. Tasks and Automations remain in the enabled inventory and are marked deferred. |
| BB active settings inventory | Passed via `bb settings show --json`; captured summary excludes custom CSS content and all credentials. General settings, theme ID, feature flags, experiments, keybinding counts, voice setting, and server access state are recorded above. |
| DSH and Node versions | Passed; installed DSH remains `0.2.0-rc.2`, launcher uses Node `v22.23.3`; no upgrades performed. |
| Active profile manifest | Passed; `~/.dsh/profiles/web` now has the owned adapter and exact DSH ACP/MCP dependencies; DSH Market removed. Original manifest, patch, and lockfile backed up under `/private/tmp/dsh-web-before-bb-migration`. |
| Dependency install | Passed offline for the updated ACP adapter and theme packages; 45 packages resolved, 43 reused, zero downloaded. No packages were upgraded. |
| Plugin listing | Passed; `dsh plugin --profile web list` reports the owned ACP account adapter plus exact-version DSH dependencies; no `dshmarket` dependency. |
| Composed profile | Passed; `dsh web --dump-config` selects `codex-personal` at `gpt-6-luna`, includes the owned ACP adapter and Tokitoki MCP registration, removes persona from the standard preset, and disables the other bundled presets implicated in the duplicate registration. No `dshmarket` appears. |
| DSH startup and HTTP | Passed; the `web` profile starts on `127.0.0.1:3080`. An unauthenticated root request returns HTTP 401, which confirms the local server is answering and enforcing its token. The tokenized route is not recorded here. |
| New session on active `web` profile | Passed in Chrome on `http://127.0.0.1:3080`; composer opens without the duplicate persona error. `/model` lists the six owned account routes and built-in providers. |
| Codex subscription route | Passed: a fresh active-profile Luna turn returned the requested exact response. No Sol request, credential copy, or API-key billing. |
| OpenCode Go | Incomplete; `/model` lists all three routes, and the Alex account has one OpenCode Go credential entry. Direct ACP generation on that profile's unspecified default returned; a direct and a live DSH turn with the required `opencode-go/deepseek-v4.1-flash` target remained pending (45s and 1m35s) and were stopped. Auth values were not read. |
| DSH built-in Codex subscription route | Not configured; a GPT-6 Luna request returned `Provider is not configured: openai-codex`. The owned `codex-personal` ACP route remains usable; the built-in provider would require its own DSH login flow. |
| DSH shell and disposable file edit | Passed through the fresh Luna session: `pwd` reported the default DSH workspace, and the assistant created/read `/private/tmp/dsh-migration-smoke/dsh-proof.txt`; an independent local read confirmed the exact requested content. The ACP route did not expose DSH filesystem tools. |
| Tokitoki MCP agent call | Passed after the owned ACP adapter began forwarding its stdio server through ACP `NewSessionRequest.mcpServers`: Luna invoked `budgets_status` and reported success; budget values were not exposed. |
| DSH native filesystem tools | Standard preset inventory shows filesystem tools enabled, but the ACP-backed session did not expose DSH-native filesystem tools. Shell-based disposable file create/readback passed. Native filesystem calls remain unverified. |
| DSH settings applied | Passed: Appearance is explicitly `Dark`; voice input is enabled and the local SenseVoiceSmall INT8 model reports ready. The browser shortcut editor rejects bare Command+B and Command+J; Command+Shift+B is already assigned to the matching right-sidebar action. A microphone permission/recording check remains user-dependent. |
| Agent/subagent round trip | Not yet verified from the active web profile; DSH-native tools are not exposed by the ACP adapter route. |
| Existing repositories and BB | No existing repository content, BB configuration, plugin state, or credentials were changed. |

## Normal use and rollback

The one DSH profile is `web`. Start it with `dsh-start` or the `dshstart` shell alias, or open **DeepSeek Harness.app** from `~/Applications`. Each starts the local web app on port 3080 and opens DSH's authenticated local route. The existing Chrome app shortcut targets the same port. Stop a terminal-launched server with Ctrl-C. Nixfiles defines the launchers and alias; the command symlinks and Applications shortcut were installed directly from validated Nix store artifacts without Home Manager activation or BB plugin hooks. The shell alias will be deployed by the next Home Manager apply.

To roll back the profile consolidation, stop DSH, restore `package.json`, `cordis.patch.yml`, and `pnpm-lock.yaml` from `/private/tmp/dsh-web-before-bb-migration`, then remove migration-only generated dependencies from the `web` profile if desired. Remove `~/.local/bin/dsh-start`, `~/.local/bin/dsh-web`, and `~/Applications/DeepSeek Harness.app`, then revert the Nixfiles JJ revision to remove their managed sources. The `desktop` profile and BB remain untouched. Keep the old `bb-migration` profile until the active `web` profile has passed the remaining interactive checks.

## Remaining work and user actions

- Owned ACP accounts and a first-party theme package now load in the single `web` profile, but **most enabled BB plugin behaviors and several BB settings are still not replicated**; the mapping table records each current status and gap.
- Implement owned replacements for enabled BB plugins where DSH's supported APIs permit them; document each exact platform boundary where they do not. Do not research or implement Tasks/Automations replacements.
- Apply remaining compatible settings: general preferences and the two unsupported browser keybindings. Dark mode and voice input are enabled; the local recognition model is ready.
- To verify voice end to end, click DSH's `Start recording` button and allow Chrome microphone access if prompted. I did not grant microphone permission or record audio.
- Diagnose why the OpenCode Go target model does not return despite an existing credential entry and a successful unspecified-default ACP turn. No account login prompt appeared; no user action is identified yet.
- Verify the remaining five account routes, native DSH filesystem tools and an agent/subagent round trip. Dadabase remains unavailable because BB exposes it only through its own MCP bridge and the host has no independently launchable endpoint or command.
- The optional built-in DSH `openai-codex` route needs its own interactive DSH login; the existing owned `codex-personal` Luna route works without that separate login.
- Project rehoming within one session and BB-specific sidebar, annotation, editor, composer, notification, and thread lifecycle surfaces remain unimplemented pending supported DSH extension APIs or a documented platform boundary.
