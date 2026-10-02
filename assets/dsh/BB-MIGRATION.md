# BB to DSH migration

This is the versioned migration record and source-of-truth plan for a first-party DSH setup. It is also exposed from `$DSH_HOME/BB-MIGRATION.md`. BB is left installed and unchanged. The owned BB AI Accounts plugin was inspected as the behavior source; its code is not copied into DSH or imported at runtime. No DSH Market package or third-party DSH plugin is used by the migration profile.

## Discovery snapshot

Checked 2026-10-02 on Apple Silicon macOS.

- BB CLI: `0.44.0`; local data directory: `~/.bb`; current project: `nixfiles`; active plugin service reports no plugins needing attention.
- BB plugin registry: 62 installed; 52 enabled and running; 10 disabled. Inventory below is from `bb plugin list --json`, which reports versions, source/provenance, running status, frontend bundles, service/schedule declarations, and contributed capabilities. Descriptions and status are verified registry metadata; underlying behavior is not source-audited unless explicitly called out.
- DSH CLI/package: `@deepseek-ai/dsh@0.2.0-rc.2`; Node `v24.20.0`; `DSH_HOME` is unset and the active home is `~/.dsh`.
- Installed DSH profiles: `web` and `desktop`. The existing `web` profile has `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `dshmarket` in its bundle list; its own package dependency is `dshmarket@^1.66.7`. Its local patch sets only a UI welcome-notice version. Its `cordis.yml` is generated output and must not be edited. The separate migration profile will omit DSH Market and will not alter `web` or `desktop`.
- The DSH web endpoint at `http://localhost:3080` returned HTTP 401 during one authorized local probe. This proves an HTTP service answered then, not that a browser session or model request is authenticated. A second sandboxed probe could not connect; service availability must be rechecked outside that restriction.
- BB server-backed metadata was queried via the documented BB CLI. Available providers are Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, three Codex account profiles, and three OpenCode Go account profiles. The primary Codex model menu includes GPT-6.1-Sol, GPT-6-Astra/Sol/Luna, GPT-5.6-Sol/Terra/Luna, and GPT-5.5; the `EM · Codex` account defaults to GPT-6-Luna. OpenCode Go account catalogs include DeepSeek V4.1 Flash and Fledge Alpha Free. “Available” is the provider registry state; it does not prove a signed-in session. Provider metadata identifies Codex/Claude/Pi CLI login flows and ChatGPT login for the Codex account plugin. API-key/account secrets were not read or copied.
- BB exposes two enabled global MCP servers through its tool directory: Dadabase and Tokitoki. Dadabase advertises saved-connection listing, bounded schema inspection and SQL query tools; Tokitoki advertises usage, session, quota, and report tools. Tool names and schemas were obtained from `mcp_list_tools`; no tool was called for this inventory.
- Nixfiles has existing Codex, OpenCodex, AI Accounts, Executor, Tokitoki, and BB plugin setup. Relevant files include `assets/codex/config.template.toml`, `assets/opencodex/config.template.json`, `assets/ai-accounts/seed.mjs`, `assets/executor/`, and the Home Manager modules. They are configuration clues only; no credential values were inspected. Nixfiles also has unrelated dirty AI-account edits in another JJ workspace, preserved during this migration.
- The BB plugin source directory `~/dev/bb-plugins` contains local implementations for AI Accounts, Auto Handoff Parent, Diff Viewed, Jujutsu, MCP Manager, Memory Watch, Preserve Child Threads, Secret Catalog, Settings Search, Sidebar Commands, Sidebar Resize, and Tokitoki Usage. These names are verified from the directory listing; their source is not copied or used for DSH replacements.

### Installed BB plugins

`replicated` means the replacement has been implemented and behavior verified; `partial` means only a subset is implemented or verified; `not replicated` means no replacement has been implemented. The table was recorded before changing DSH; statuses are updated below as verification completes.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| `action-topbar` | Community plugin, v0.1.0, running, app bundle; mirrors thread tabs and launcher | Platform boundary: DSH custom thread-topbar UI not verified | not replicated | UI behavior from registry description |
| `agent-annotations` | BB built-in v0.1.0, running, app and thread mention; browser element comments | Platform boundary: no equivalent browser-tab annotation surface verified | not replicated | Tool/skill offered by BB plugin |
| `ai-accounts` | Local path plugin v0.1.0, running, UI/service; six provider IDs, including three isolated Codex homes | Owned DSH ACP LLM adapter exposes six routes in the DSH model picker | partial | Codex routes are fixed to Luna and use existing homes; OpenCode Go routes use separate XDG homes. Model selection/new sessions hit the DSH persona error. Profile editor, quota history and provider-side session reuse remain gaps. |
| `ask-user-question` | BB built-in v0.1.0, running, agent tool | First-party DSH user-question tool in standard preset | partial | Present in installed composition; session creation blocker prevents an interactive round trip. |
| `automations` | BB built-in v0.1.0, running, schedule UI/service | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `bb-guide` | BB built-in v0.1.0, running; skills and onboarding | DSH agent instructions plus filesystem skills | partial | Uses Nix-managed `~/.agents/skills`; prompt injection behavior not independently runtime-tested |
| `bb-sidebar` | Community plugin v0.2.26, running; sort, snooze, settle | Platform boundary: BB sidebar organization UI | not replicated | No DSH UI slot verified |
| `chat-search` | Community plugin v0.1.3, running, app bundle | Partial owned session-search command/plugin if DSH session query API allows | not replicated | Search scope needs to match BB open-chat search |
| `chatgpt-skin` | Community plugin v0.1.5, running, theme registration | Platform boundary: DSH web theme extension not verified | not replicated | BB custom theme is verified active registry metadata |
| `command-code` | Community plugin v0.1.2, running; ACP provider | Owned provider integration only if installed DSH APIs support the needed transport | not replicated | API-key billing must not replace existing auth silently |
| `concurrency-limit` | BB built-in v0.1.0, running; concurrency controls | Partial owned DSH configuration | not replicated | DSH agent/subagent concurrency knobs need verification |
| `connect` | BB built-in v0.1.0, running; remote access | Platform boundary or owned deployment config, pending DSH listener/auth API | not replicated | Do not expose DSH remotely during this migration |
| `custom-instructions` | BB built-in v0.1.0, running; persistent task instructions | DSH agent-instructions plugin in the standard preset | partial | Configured; file discovery and precedence are not runtime-verified because DSH cannot create a fresh session. |
| `diff-viewed` | Local plugin v0.1.2, running, app bundle | Platform boundary: custom per-file diff UI not verified | not replicated | |
| `environment-git-worktree` | BB built-in v0.1.0, running; isolated worktree provider | Partial owned workspace launcher/configuration | not replicated | DSH workspace sandbox exists; worktree lifecycle parity unverified |
| `environment-personal-workspace` | BB built-in v0.1.0, running; personal workspace provider | Partial owned workspace configuration | not replicated | Per-thread workspace behavior unverified |
| `environment-project-checkout` | BB built-in v0.1.0, running; checkout provider | Partial owned workspace configuration | not replicated | Branch/checkout selection parity unverified |
| `fast-split` | Community plugin v0.1.0, running, app bundle | Platform boundary: neighboring thread panes | not replicated | |
| `files-editor` | Community plugin v0.1.6, running, app bundle and skill; tree/search/editor | DSH filesystem edit/search tools in the standard preset | partial | Tools are configured; agent-mediated disposable read/write test is blocked by the DSH session error. |
| `handoff` | Community plugin v0.7.2, running, app bundle and skill; session/provider/machine handoff | Partial owned DSH commands if supported import/export interfaces exist | not replicated | Cross-provider session continuity may be a platform boundary |
| `hotspot` | Community plugin v0.1.0, running; tools and skill | Owned diagnostic command only if DSH can use safe host metadata | not replicated | Do not poll; do not claim per-plugin attribution without evidence |
| `inline-vis` | BB built-in v0.1.0, running; inline HTML/Markdown renderer | Platform boundary: inline assistant-message rendering | not replicated | |
| `jujutsu` | Local plugin v0.1.0, running; CLI and skill | Host `jj` CLI through DSH Bash plus the existing Jujutsu skill | partial | Host command and skill are available; session blocker prevented DSH-mediated verification. |
| `keep-awake` | BB built-in v0.1.0, running; macOS awake behavior | Owned opt-in command/config if supported | not replicated | Never keep awake by default |
| `mcp-manager` | Local plugin v0.1.0, running; MCP server management/tools | DSH first-party MCP client configured for local Tokitoki | partial | Tokitoki client is configured; DSH agent tool call is blocked by session creation. Dadabase endpoint is not present in inspected host config. |
| `memory` | Community plugin v0.2.0, running; durable provider-independent memory | Partial owned DSH memory instructions/storage | not replicated | Cross-provider search and attribution need an owned implementation |
| `memory-watch` | Local plugin v0.1.0, running; host/plugin memory diagnostics | Owned opt-in, bounded host diagnostic if safe APIs permit | not replicated | Avoid polling |
| `message-timestamps` | Community plugin v0.1.0, running, app bundle | Platform boundary unless DSH timeline exposes timestamp formatting | not replicated | |
| `monaco-editor` | BB built-in v0.1.0, running; editor replacement | Platform boundary: DSH editor component integration | not replicated | |
| `navigation` | BB built-in v0.1.0, running; sidebar destinations | Platform boundary: DSH navigation UI | not replicated | |
| `pdf-preview` | BB built-in v0.1.0, running; PDF viewer | DSH filesystem workflow | partial | File access only; preview UI not replicated |
| `plugin-api-docs` | BB built-in v0.1.0, running; API browser/mention | Owned DSH development notes from installed API docs | not replicated | Do not port BB API docs/source |
| `plugin-api-tester` | BB built-in v0.1.0, running; test plugin APIs | Owned DSH smoke command/fixture if API is documented | not replicated | |
| `preserve-child-threads` | Local plugin v0.1.0, running; archive lifecycle and thread linking | Platform boundary: DSH thread-tree lifecycle UI/API not verified | not replicated | |
| `provider-acp` | BB built-in v0.1.0, running; Cursor and OpenCode ACP providers | Owned ACP LLM adapter for the available Codex and OpenCode Go account homes | partial | Routes are visible in DSH model picker; session/provider operations hit the DSH persona error before ACP starts. Cursor account route is not configured. |
| `provider-claude-code` | BB built-in v0.1.0, running; Claude CLI provider | Owned provider adapter if supported DSH interface exists | not replicated | Native CLI login remains host-local |
| `provider-codex` | BB built-in v0.1.0, running; Codex provider | Owned DSH ACP account adapter launches Codex with existing `CODEX_HOME` | partial | A direct ACP smoke passed with personal `gpt-6-luna`; invoking the DSH route is blocked by the DSH session error. No credential copy or API-key billing. |
| `provider-pi` | BB built-in v0.1.0, running; Pi provider | Owned adapter only if supported DSH interface exists | not replicated | |
| `provider-retry` | BB built-in v0.1.0, running; retry after overload/reset | DSH first-party retry plugin | partial | Generic retry exists; account reset-specific retry behavior is not verified |
| `provider-usage` | BB built-in v0.1.0, running; usage settings/sidebar | Partial owned Tokitoki integration | not replicated | DSH token meter is not automatically BB provider usage parity |
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

The dedicated profile is `~/.dsh/profiles/bb-migration`, built from the installed DSH base and web-app bundles. It excludes `dshmarket`; the stock `web` and `desktop` profiles are untouched. The profile's default route is now our owned `codex-personal` adapter at `gpt-6-luna`, so it uses the existing ChatGPT subscription home rather than requiring a separate DSH OAuth login. The model menu exposes six owned routes: three Codex homes fixed to Luna, and three OpenCode Go homes pinned to `opencode-go/deepseek-v4.1-flash`.

The adapter is in `~/dev/dsh-plugins/packages/acp-accounts`. It uses DSH's `LlmAdapter`, `SessionStore`, managed subprocess service, and ACP SDK 1.5.1. It replays the visible DSH session transcript into a fresh ACP session each turn, so provider selection is designed to keep the same DSH timeline. It does not retain provider-side process state, pass images, or bridge ACP permission requests; those are cancelled. It reads the account homes in place and never copies or prints their credential files.

**A DSH runtime blocker prevents using the model picker or starting a fresh chat in the installed version.** DSH 0.2.0-rc.2 returns `agent-preset/invalid` with `persona (@deepseek-ai/dsh-persona): prompt section "deployment:persona-prefix" is already registered`. The same error occurred on `New session` and provider selection; it also reproduced with the migration profile's default changed to `minimal` and with the owned ACP bundle disabled. Those operations failed before any DSH model request. This is independent of the owned adapter and is recorded as a platform boundary; upgrading DSH or modifying DSH core is outside scope.

A direct ACP smoke prompt using the existing personal Codex home completed and returned the expected sentinel with `gpt-6-luna`. No login prompt appeared, no API key was used, and no credentials were copied. The OpenCode Go Alex ACP and plain CLI smoke attempts did not return within 60 seconds; both were stopped, so OpenCode generation remains unverified. The DSH UI did list the OpenCode account routes.

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

The migration launcher selects Node `v22.23.3`, port 3081, and DSH's one-time browser token. The authenticated UI loaded in Chrome. The existing installed Chrome app named DeepSeek Harness still points to port 3080; the migration launcher is the supported entry point for this profile. The dedicated 3081 process was stopped after checks.

The complete BB plugin inventory below is from `bb plugin list --json`: 62 installed, 52 enabled and running, 10 disabled. Descriptions and running state are registry metadata; source behavior is claimed only where separately inspected or exercised.

### Other material BB settings and integrations

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Providers and models | Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, and six AI Accounts routes | DSH native Pi AI providers plus owned ACP account LLM adapter | partial | Model picker lists owned routes. Session creation/provider changes hit the DSH persona error before generation. |
| Codex subscription accounts | Three named `CODEX_HOME` profiles managed by BB AI Accounts | Owned `codex-personal`, `codex-work`, and `codex-alex2` routes, each fixed to Luna | partial | Direct personal ACP smoke passed on `gpt-6-luna`; running the DSH route is blocked by DSH core. No credentials copied or API-key billing used. |
| OpenCode Go accounts | Three named profiles isolated by `XDG_DATA_HOME` | Owned `opencode-go-alex`, `opencode-go-manu`, and `opencode-go-mathias` routes | partial | Routes are listed. ACP and CLI prompts stalled beyond 60 seconds; no output or login prompt was observed. |
| Skills and agent instructions | BB registry, Nix-managed user skills and project instructions | DSH standard preset's instruction and filesystem-skill plugins | partial | Configured in the installed composition. User skill discovery and precedence are not runtime-verified because DSH cannot create a fresh session. |
| MCP servers | BB MCP Manager; Dadabase and Tokitoki | DSH first-party MCP client; Tokitoki stdio configured | partial | Tokitoki direct stdio handshake and read-only `budgets_status` were verified earlier; DSH agent tool use is blocked by session creation. Dadabase's standalone endpoint/command is not present in inspected config. |
| Shell and files | BB host shell, file tools and editor | DSH first-party Bash, filesystem edit and search tools | partial | Standard preset composition is verified; agent-mediated disposable file smoke test is blocked by session creation. |
| Git and JJ | BB environment providers and Jujutsu plugin | Host `jj` CLI, DSH workspace selection and existing Jujutsu skill | partial | No DSH worktree lifecycle parity; no existing repository was changed by this migration. |
| Browser and terminal | BB browser tools and scoped persistent terminals | DSH web search/fetch and shell APIs | partial | Browser DOM control and persistent-terminal parity are not established. |
| Planning and persistence | BB plan, goals, forks/rewind and local sessions | DSH plan/goal tools, subagents and JSONL session storage | partial | APIs/config are present; new session failure blocks end-to-end use and cross-provider import/rewind parity is absent. |
| Permissions and approvals | Provider-specific permission levels and prompts | DSH access presets and approval service | partial | Migration profile retains Workspace Write and default approval behavior. ACP permission requests are rejected in the account adapter because no DSH approval bridge is available. |
| Hooks, commands and prompts | BB plugin commands, prompt registry and skills | DSH built-in command and instruction APIs | partial | No owned BB command-palette port; profile behavior is blocked before a session starts. |
| UI, keybindings and theme | BB custom theme, tabs, navigation, annotations and composer plugins | DSH web UI and installed plugin extension points | partial | The DSH UI loads. BB-specific sidebar, thread-topbar, settings search, annotations, diff status, and notification surfaces are not replicated. |
| Secret CLI | BB Secret Catalog and secure credential request flows | Host `secret` CLI remains available to DSH shell/skills | partial | No secret value was requested or read for this migration. Interactive secret capture and BB approval UI are not reproduced. |
| Usage and account meters | BB Provider Usage, Tokitoki and AI Accounts quota history | DSH token metering plus configured Tokitoki MCP client | partial | Token meter is present; account-specific quota history and provider usage visualization are not implemented. |
| Tasks and Automations | BB Tasks and scheduled automation plugins | None | deferred | Explicitly out of scope; no replacement research or implementation. |

## Initial mapping and implementation plan

The initial inventory and mapping were written before DSH profile changes. The implementation order was:

1. Preserve the stock DSH profiles and create an isolated profile without DSH Market.
2. Reproduce account selection first with an owned ACP-backed DSH LLM adapter, using existing account homes without moving credentials.
3. Reuse supported DSH core plugins/configuration for shell, files, instructions, skills, planning, session persistence, permissions, MCP, and web tools.
4. Verify the profile start, account authentication, route selection, shell/file operations, MCP, same-session provider changes, and the parked composer/project workflows.
5. Record platform boundaries precisely and update status only from runtime evidence.

Steps 1-3 are implemented as profile configuration and an owned plugin. Step 4 is partially blocked by the reproduced DSH persona-registration failure described above; the exact checks and outcomes are listed below.

## Remaining mapping and gaps

The parked BB threads establish these product requirements:

- `Fix send later breaking the new thread button`: the composer’s delayed-send control must not interfere with starting a new thread.
- `Allow changing the project of an existing thread`: the desired result is one visible conversation timeline while changing provider/account or project; parent-child grouping and handoff do not meet the requirement.
- `Do we need the official Codex plugin if we built`: the official provider and account-management layer have different roles. Keep DSH's normal Codex route available, while the owned account routes use their own existing subscription homes.

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Same visible timeline across providers/accounts | BB currently requires handoff for provider/account changes; user wants one timeline | DSH model selection and owned account LLM routes can select a different provider for a DSH session | partial | Architecture supports one DSH session with per-turn provider selection, but current DSH runtime rejects model/session operations before a turn. |
| Change project/workspace on the same timeline | BB requires a fork/new thread for a project change | DSH lets a new session choose a workspace; existing session header has immutable `cwd` and the installed API exposes no move-session operation | Platform boundary | No supported session rehome/update API was found. A plugin cannot safely change the existing persisted session's working-directory identity. |
| Send later without breaking New Thread | BB scheduled-send composer extension currently interferes with New Thread | No owned DSH composer replacement yet | not replicated | Distinct from deferred Automations. DSH's input-trigger UI extension surface was identified, but an owned delayed-send implementation and round-trip test remain. |
| Account editor and usage history | BB AI Accounts UI manages profiles, catalogs, identity and quota history | Owned fixed account routes in the DSH model picker | partial | Account menu behavior is replicated in configuration; editable profiles, usage meters, account identity display, and session continuity inside ACP processes are not. |
| Dadabase MCP | BB-managed server advertises connection, schema and SQL tools | None | Platform boundary | No independently launchable endpoint/command was found in the inspected host config. DSH can connect to MCP servers, but requires an address or executable. |
| Browser annotations, thread panes, app navigation and visual settings | BB app UI plugins | DSH web UI extension points where installed and documented | not replicated | No API was verified for these specific BB surfaces; a similar default UI is not counted as parity. |
| Codex / OpenCode ACP providers | BB provider bridge supports interactive provider sessions | Owned ACP LLM adapter | partial | Codex Luna ACP was exercised directly. DSH UI invocation is blocked by DSH core; OpenCode Go request did not return before timeout. |
| Tasks and Automations | Enabled BB plugins | None | deferred | No investigation or implementation by request. |

## Changes made

- Created isolated `~/.dsh/profiles/bb-migration` from the installed web template, excluding `dshmarket`. `web` and `desktop` bundles/configuration were left unchanged.
- Added exact-version first-party DSH MCP and ACP subagent packages to the migration profile; added the DSH-owned local ACP account adapter from `~/dev/dsh-plugins/packages/acp-accounts`.
- Added six owned account routes. Codex routes are pinned to GPT-6 Luna and use existing homes; OpenCode Go routes use the existing isolated XDG data roots and the Nix-managed `opencode` command from PATH.
- Set the migration profile default to `codex-personal` at `gpt-6-luna`; native `openai-codex` remains a separate optional DSH route and is not the default.
- Added Tokitoki's local stdio MCP registration and the `assets/dsh/start-bb-migration` launcher (Node v22.23.3, port 3081, tokenized UI route).
- Corrected the owned adapter to the installed ACP SDK 1.5.1 `ClientContext.request(...)` API and its select-config request shape.
- No BB settings, plugins, servers, credentials, or unrelated Nix configuration were changed. No DSH, BB, or unrelated package was upgraded. No DSH Market plugin is used by the migration profile.

## Verification performed

| Check | Result |
|---|---|
| BB plugin inventory via `bb plugin list --json` | Passed; 62 installed, 52 enabled/running, 10 disabled. Tasks and Automations marked deferred. |
| DSH package/profile versions | Passed; CLI/package `0.2.0-rc.2`; isolated profile uses exact installed DSH packages; stock profiles unchanged. |
| DSH profile composition | Passed; `dsh --profile bb-migration --patch assets/dsh/bb-migration.patch.yml --dump-config` shows the owned ACP adapter, six account routes, Tokitoki, and default Luna route. |
| Owned plugin registry/model list | Passed; package is in `dsh plugin --profile bb-migration list`; authenticated UI model picker displayed all six account routes. |
| Owned plugin startup | Passed; migration profile bound to localhost:3081 and the UI loaded in Chrome without a plugin activation/startup error. |
| DSH new session/provider change | Blocked; both failed before model generation with duplicate `deployment:persona-prefix`. Reproduced with minimal default preset and with the ACP adapter disabled. |
| Codex ACP subscription auth | Passed directly through ACP SDK 1.5.1 using `CODEX_HOME=~/.codex` and model `gpt-6-luna`; exact bounded smoke response returned. No Codex Sol model was selected or requested. |
| OpenCode Go ACP/CLI | Incomplete; one minimal request through ACP and one through `opencode run` did not return within 60 seconds; both were stopped. Existing Go model catalog is available. No credential data was inspected. |
| Shell and filesystem agent operations | Blocked; new DSH sessions cannot start. No test file was written. |
| DSH MCP tool call | Blocked in DSH by session creation. Tokitoki stdio ACP/MCP-independent handshake and `budgets_status` direct check were verified earlier; no values were recorded. |
| Port 3081 HTTP/UI | Passed; authenticated UI loaded through the one-time route. Port 3082 was used only for temporary isolation and stopped. |
| Existing DSH web UI on port 3080 and BB | Left running/unchanged. |
| Logs | The current server started without a plugin activation error. Old startup logs contain earlier duplicate-port/plugin-start diagnostics; no raw log contents or credentials were copied into this document. |

## Normal use and rollback

From this Nixfiles checkout, run:

```sh
./assets/dsh/start-bb-migration
```

This starts the isolated migration profile on port 3081 with Node `v22.23.3` and opens the one-time tokenized route in the browser. Use `--no-open` to keep it in the foreground without opening a page. The current installed Chrome app remains associated with port 3080; run this command to open the separate migration profile. Stop the server with Ctrl-C.

The model selector contains the owned account routes. Codex routes are all fixed to Luna; OpenCode Go routes use each existing isolated profile. Provider selection is intended to keep the DSH timeline, but DSH 0.2.0-rc.2 currently fails to create/resume sessions with a duplicate persona-section error, so the profile is not usable for conversations until that installed runtime issue is fixed. Do not use the native DSH Codex API-key route as a substitute for subscription auth.

To roll back only migration changes: stop the migration process; remove `~/.dsh/profiles/bb-migration` and the `~/.dsh/BB-MIGRATION.md` symlink; revert the Nixfiles JJ revision that adds `assets/dsh/`; and remove or revert the account-adapter revision in `~/dev/dsh-plugins`. This does not change the stock `web`/`desktop` profiles or BB.

## Remaining user actions

- No credential or login action is required for the verified personal Codex ACP route. The direct DSH-native Codex OAuth route remains separate and should only be used if you want DSH to keep its own login.
- DSH's duplicate persona-section failure needs a compatible DSH runtime fix; the migration did not upgrade DSH or edit DSH core. After that is resolved, rerun a DSH new-session/provider-switch check, a disposable shell/file operation, and Tokitoki tool call.
- OpenCode Go generation is still unverified after a 60-second stall. If its ACP CLI prompts for login when retried, complete login inside the correct existing account home yourself; no secret value has been requested.
- Project changes within an existing session remain blocked by the absence of a DSH session-rehome API. Send Later has not been implemented; the composer failure requirement is recorded and remains in scope, separate from deferred Automations.
- A dedicated Chrome app shortcut for port 3081 has not been installed yet; the launcher opens the authenticated migration page in Chrome. The already-installed DeepSeek Harness app still points at port 3080.



- Open the migration profile and sign in to DSH's `openai-codex` route using DSH's own authorization flow. DSH does not reuse credentials from Pi, BB account homes, or Codex ACP processes.
- The `work` Codex home was reported as not logged in during safe auth-status inspection. If it is still needed, sign it in yourself using `CODEX_HOME="$HOME/.local/share/bb-ai-accounts/codex/work" codex login`; no credential file needs to be copied. Personal and `alex2` homes were reported as logged in, but their auth state was not rechecked during implementation.
- After login, run one disposable DSH shell/file operation, one Tokitoki report query, and (if desired) one Codex ACP child using Luna. These remain unverified because no authenticated model call was made.
- Claude Code, Cursor ACP, OpenCode ACP, and OpenCode Go account switching remain unimplemented. Codex ACP account selection is partial; persistent sessions, model catalog editing, and usage history remain gaps.
