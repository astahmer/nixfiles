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
| `ai-accounts` | Local path plugin v0.1.0, running, UI/service; six provider IDs, including three isolated Codex homes | Owned DSH config planned first: one official ACP subagent profile per existing Codex home, all fixed to Luna | partial | Replicates account choice/delegation only; DSH ACP subagents are fresh one-shot child agents, not persistent BB provider sessions. Model UI, profile editor, quota history, and login flow remain gaps. Never copy credentials |
| `ask-user-question` | BB built-in v0.1.0, running, agent tool | First-party DSH user-question tool in standard preset | partial | Present in installed composition; interactive round trip not exercised |
| `automations` | BB built-in v0.1.0, running, schedule UI/service | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `bb-guide` | BB built-in v0.1.0, running; skills and onboarding | DSH agent instructions plus filesystem skills | partial | Uses Nix-managed `~/.agents/skills`; prompt injection behavior not independently runtime-tested |
| `bb-sidebar` | Community plugin v0.2.26, running; sort, snooze, settle | Platform boundary: BB sidebar organization UI | not replicated | No DSH UI slot verified |
| `chat-search` | Community plugin v0.1.3, running, app bundle | Partial owned session-search command/plugin if DSH session query API allows | not replicated | Search scope needs to match BB open-chat search |
| `chatgpt-skin` | Community plugin v0.1.5, running, theme registration | Platform boundary: DSH web theme extension not verified | not replicated | BB custom theme is verified active registry metadata |
| `command-code` | Community plugin v0.1.2, running; ACP provider | Owned provider integration only if installed DSH APIs support the needed transport | not replicated | API-key billing must not replace existing auth silently |
| `concurrency-limit` | BB built-in v0.1.0, running; concurrency controls | Partial owned DSH configuration | not replicated | DSH agent/subagent concurrency knobs need verification |
| `connect` | BB built-in v0.1.0, running; remote access | Platform boundary or owned deployment config, pending DSH listener/auth API | not replicated | Do not expose DSH remotely during this migration |
| `custom-instructions` | BB built-in v0.1.0, running; persistent task instructions | DSH agent-instructions plugin | partial | Reads applicable instruction files; exact precedence differs from BB and needs user review |
| `diff-viewed` | Local plugin v0.1.2, running, app bundle | Platform boundary: custom per-file diff UI not verified | not replicated | |
| `environment-git-worktree` | BB built-in v0.1.0, running; isolated worktree provider | Partial owned workspace launcher/configuration | not replicated | DSH workspace sandbox exists; worktree lifecycle parity unverified |
| `environment-personal-workspace` | BB built-in v0.1.0, running; personal workspace provider | Partial owned workspace configuration | not replicated | Per-thread workspace behavior unverified |
| `environment-project-checkout` | BB built-in v0.1.0, running; checkout provider | Partial owned workspace configuration | not replicated | Branch/checkout selection parity unverified |
| `fast-split` | Community plugin v0.1.0, running, app bundle | Platform boundary: neighboring thread panes | not replicated | |
| `files-editor` | Community plugin v0.1.6, running, app bundle and skill; tree/search/editor | DSH filesystem and search tools in standard preset | partial | Tool APIs are present; disposable read/write smoke test remains |
| `handoff` | Community plugin v0.7.2, running, app bundle and skill; session/provider/machine handoff | Partial owned DSH commands if supported import/export interfaces exist | not replicated | Cross-provider session continuity may be a platform boundary |
| `hotspot` | Community plugin v0.1.0, running; tools and skill | Owned diagnostic command only if DSH can use safe host metadata | not replicated | Do not poll; do not claim per-plugin attribution without evidence |
| `inline-vis` | BB built-in v0.1.0, running; inline HTML/Markdown renderer | Platform boundary: inline assistant-message rendering | not replicated | |
| `jujutsu` | Local plugin v0.1.0, running; CLI and skill | Host `jj` CLI through DSH Bash plus existing Jujutsu skill | partial | Skill is discoverable; no repository mutation was tested |
| `keep-awake` | BB built-in v0.1.0, running; macOS awake behavior | Owned opt-in command/config if supported | not replicated | Never keep awake by default |
| `mcp-manager` | Local plugin v0.1.0, running; MCP server management/tools | DSH first-party MCP client configured for local Tokitoki | partial | Configured and profile starts; tool discovery/call remains unverified. Dadabase has no confirmed DSH-reachable endpoint |
| `memory` | Community plugin v0.2.0, running; durable provider-independent memory | Partial owned DSH memory instructions/storage | not replicated | Cross-provider search and attribution need an owned implementation |
| `memory-watch` | Local plugin v0.1.0, running; host/plugin memory diagnostics | Owned opt-in, bounded host diagnostic if safe APIs permit | not replicated | Avoid polling |
| `message-timestamps` | Community plugin v0.1.0, running, app bundle | Platform boundary unless DSH timeline exposes timestamp formatting | not replicated | |
| `monaco-editor` | BB built-in v0.1.0, running; editor replacement | Platform boundary: DSH editor component integration | not replicated | |
| `navigation` | BB built-in v0.1.0, running; sidebar destinations | Platform boundary: DSH navigation UI | not replicated | |
| `pdf-preview` | BB built-in v0.1.0, running; PDF viewer | DSH filesystem workflow | partial | File access only; preview UI not replicated |
| `plugin-api-docs` | BB built-in v0.1.0, running; API browser/mention | Owned DSH development notes from installed API docs | not replicated | Do not port BB API docs/source |
| `plugin-api-tester` | BB built-in v0.1.0, running; test plugin APIs | Owned DSH smoke command/fixture if API is documented | not replicated | |
| `preserve-child-threads` | Local plugin v0.1.0, running; archive lifecycle and thread linking | Platform boundary: DSH thread-tree lifecycle UI/API not verified | not replicated | |
| `provider-acp` | BB built-in v0.1.0, running; Cursor and OpenCode ACP providers | DSH official ACP subagent client over the supported subagent seam | partial | DSH API supports one-shot ACP children, not BB's interactive ACP provider bridge/session lifecycle |
| `provider-claude-code` | BB built-in v0.1.0, running; Claude CLI provider | Owned provider adapter if supported DSH interface exists | not replicated | Native CLI login remains host-local |
| `provider-codex` | BB built-in v0.1.0, running; Codex provider | Owned DSH config launches Codex through official `@agentclientprotocol/codex-acp` under each existing `CODEX_HOME` | partial | Uses subscription auth already in each home; no credential copy or API-key billing. Login/auth and actual run still need user verification |
| `provider-pi` | BB built-in v0.1.0, running; Pi provider | Owned adapter only if supported DSH interface exists | not replicated | |
| `provider-retry` | BB built-in v0.1.0, running; retry after overload/reset | DSH first-party retry plugin | partial | Generic retry exists; account reset-specific retry behavior is not verified |
| `provider-usage` | BB built-in v0.1.0, running; usage settings/sidebar | Partial owned Tokitoki integration | not replicated | DSH token meter is not automatically BB provider usage parity |
| `push-notifications` | BB built-in v0.1.0, running; mobile/web/desktop notifications | Platform boundary: notification clients not verified in DSH | not replicated | |
| `scheduled-send` | BB built-in v0.1.0, running; delayed composer send | Platform boundary or owned command, pending DSH web composer API | not replicated | Distinct from deferred Automations |
| `secret-catalog` | Local plugin v0.1.0, running; safe alias listing and scoped reads | Existing host `secret-cli` skill available to DSH | partial | No secret values were read; alias listing was not runtime-tested |
| `secrets` | BB built-in v0.1.0, running; secure credential request and dotenv reconciliation | Partial owned DSH instruction/tool workflow | not replicated | User interaction may remain necessary |
| `settings-search` | Local plugin v0.1.0, running; indexed settings filter/navigation | Platform boundary: DSH settings search API/UI not verified | not replicated | |
| `side-chat` | BB built-in v0.1.0, running; hidden conversation forks | Platform boundary: DSH side-chat UI | not replicated | |
| `sidebar-commands` | Local plugin v0.1.0, running; plugin page command palette | Platform boundary: DSH app command palette registration | not replicated | |
| `sidebar-resize` | Local plugin v0.1.0, running; resizable sidebar panes | Platform boundary: DSH layout customization API | not replicated | |
| `simple-notes` | Community plugin v0.2.3, running; collaborative Markdown docs and undo | DSH filesystem editing | partial | Editing is available; collaborative undo and approvals are not replicated |
| `tasks` | Community plugin v0.1.2, running; task planning/delegation and mention integration | Deferred: Tasks or Automations | deferred | No DSH replacement research or implementation |
| `tokitoki-usage` | Local plugin v0.1.0, running; Tokitoki usage surface | `@astahmer/dsh-tokitoki-usage`, bounded read-only cached quota summary command | partial | Added to the web profile and live composer registration verified. Command output was not invoked to avoid exposing real quota values; edge badge, popover, provider marks, and minute polling remain DSH UI boundaries. |
| `usage` | Community plugin v0.3.18, running; cross-machine coding-agent usage/cost | Partial owned DSH usage reporting | not replicated | Pricing/account coverage needs verification |

### Implementation and verification update

Installed API review confirmed that the DSH web app's `standard` preset wires first-party tools for Bash, filesystem editing/search, agent instructions, filesystem skills, planning/goals, user questions, and in-process subagents. JSONL session persistence is in the base bundle. These are configured DSH APIs; no BB or Market source is used. The installed web bundle leaves some tools disabled at the root scope but enables them in the selected standard agent preset.

The DSH account and adapter inventory is narrower than BB's provider set. DSH v0.2.0-rc.2 includes the outgoing `@deepseek-ai/dsh-subagent-acp` capability as a separate package: it can launch an ACP agent in a child process and expose it through a DSH delegation tool. This is the matching protocol shape for the BB AI Accounts plugin, which launches `@agentclientprotocol/codex-acp` through BB's ACP provider bridge. It is an agent delegation path, not a selectable DSH LLM provider route: each call starts a fresh child turn and only returns the final result. The official DSH `@deepseek-ai/dsh-subagent-codex` package is another supported path, but uses Codex app-server rather than ACP. The migration will first reproduce the three Codex account choices as owned DSH configuration over DSH's official ACP subagent API; it will pin Codex to `gpt-6-luna` and use each existing account home without copying credentials. Persistent BB provider sessions, model catalog controls, and usage history remain gaps.

The migration profile is `~/.dsh/profiles/bb-migration`: it contains only the shipped DSH base and web-app bundles, with no DSH Market. Its exact-version dependencies are first-party `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2`, first-party `@deepseek-ai/dsh-subagent-acp@0.2.0-rc.2`, and ACP-compatible `@agentclientprotocol/codex-acp@2.0.1`. The last package is the Codex ACP runtime, not a DSH plugin; no DSH Market or third-party DSH plugin is used. The owned patch file at `assets/dsh/bb-migration.patch.yml` registers the local Tokitoki CLI MCP server and three named Codex account children in the standard profile. Each Codex child uses its existing account home and `gpt-6-luna`; ACP permission prompts are rejected by default. MCP tools are loaded eagerly before a first turn and all Tokitoki report tools are available while connected; this may add tool-schema context. `Dadabase` has no confirmed standalone endpoint or server command outside BB, so it remains a platform boundary until one is identified.

The launcher `assets/dsh/start-bb-migration` selects Node `v22.23.3`, applies the owned patch, uses port 3081, and opens DSH's one-time process-token browser route. A no-open startup check bound localhost:3081 and returned an HTTP response (unauthenticated `/` returned 401, as expected for the token-protected UI). The server was stopped after the check; the existing `web` server on port 3080 was not touched. This verified process startup and listener behavior, but did not verify an authenticated model turn or Tokitoki tool call.

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
| `tokitoki-usage` | Local BB plugin backed by Tokitoki | `@astahmer/dsh-tokitoki-usage`, bounded read-only cached quota summary command | partial | Web profile wiring and live composer registration verified. Execution/output not verified to avoid exposing real quota values; edge badge, popover, provider marks, and minute polling remain DSH UI boundaries. |
| `ai-accounts` and provider plugins | BB provider registry and account-switch UI | Owned DSH ACP account choices over the first-party subagent API; default model is configured separately | partial | Codex choices delegate one fresh child turn per call; persistent provider sessions, model catalog controls, and usage history remain gaps. Codex ACP run is not exercised pending user auth and per instruction no model/token call |
| Tasks and Automations | Enabled BB plugins | None | deferred | Explicitly out of scope |

Disabled installed plugins, recorded for completeness: `account-pool`, `agent-graph`, `agent-tools`, `auto-handoff-parent`, `drafts`, `prompts`, `tabs`, `thread-list`, `traces`, and `workflows`. They are not treated as enabled capabilities and are not migration targets.

### Other material BB settings and integrations

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Providers and models | BB provider registry includes Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, and AI Accounts profiles; permission modes are provider-specific | DSH ships Pi AI as an LLM adapter and its official ACP subagent seam; account config binds Codex ACP children to each existing home | partial | ACP path delegates whole agent turns; it does not register Codex as a persistent selectable DSH model provider. Main DSH LLM route still requires separate DSH OAuth |
| Codex subscription accounts | AI Accounts exposes three Codex profiles, with ChatGPT sign-in flow in its metadata | Owned DSH config maps one ACP subagent choice to each existing `CODEX_HOME`; configured model is `gpt-6-luna` | partial | No credential copying or API-key substitution. Requires existing Codex OAuth in each home; ACP child permissions default to reject and its one-shot lifecycle differs from BB |
| OpenCode Go accounts | AI Accounts exposes three named profiles; Nixfiles/OpenCodex references environment-based keys | Partial owned config only if account isolation and secret sourcing are supported | not replicated | Only variable names may be referenced; do not read values |
| Skills and agent instructions | BB built-ins, installed skills, global instructions from `~/.agents`, Codex project instructions | DSH built-in instruction and skill filesystem plugins | partial | Existing Nix-managed skills should be discovered from `~/.agents/skills`; inspect resulting behavior in an authenticated session |
| MCP servers | BB MCP Manager; two enabled servers: Dadabase and Tokitoki | DSH first-party MCP client; Tokitoki stdio configured | partial | Tokitoki tool call still needs verification. Dadabase endpoint is unknown outside BB |
| Browser and terminal | BB browser control plus persistent scoped terminals | DSH Bash plus web search/fetch | partial | Browser control/DOM automation and persistent terminal parity are not established |
| Git integration | BB project/environment and Git worktree providers; Nixfiles agent guidance prefers JJ | DSH Bash tools plus existing `jj` skill | partial | No worktree lifecycle or BB environment-picker UI replacement |
| Planning and persistence | BB provider plan/goal actions, fork/rewind capability varies; BB stores sessions locally | DSH plan/goal, subagents, and JSONL persistence | partial | Core APIs are present; cross-provider import/rewind parity is unverified |
| Permissions and approvals | BB provider permission modes include `accept-edits`, `auto`, and `full` for Codex/Claude; narrower modes for ACP/Pi | DSH built-in read-only/workspace-write/danger-full-access presets; default asks | partial | DSH's `workspace-write` plus approval `ask` is the retained default. No global permission broadening was applied |
| UI, keybindings, themes | BB has server-synced UI settings, plugins, and custom ChatGPT theme | Platform boundary pending documented DSH UI APIs | not replicated | Do not count a visually similar stock screen as parity |
| Hooks, commands, prompts | Plugin CLI commands and contributed skills are reported by BB plugin metadata; `prompts` plugin is disabled | DSH built-in commands and skill command workflows | partial | BB command-palette/shortcut registration is not available through the verified DSH API |
| Shell and files | BB host integrations plus file/editor plugins | DSH Bash, filesystem edit/search, and built-in permission presets | partial | Tool APIs are configured; disposable smoke test remains |

## Initial mapping and implementation plan

DSH v0.2.0-rc.2's installed `@deepseek-ai/dsh-base` bundle documents supported plugin composition and includes first-party DSH plugins for agent tools, Bash sandboxing, filesystem access/search, plan mode, questions, subagents, skills, JSONL session persistence, web search/fetch, local jobs, token metering, and retry. These are platform APIs, not replacements by DSH Market. The current `web` profile also includes DSH Market; the migration will use a separate profile derived from the shipped web profile and exclude that dependency.

1. Complete targeted read-only inspection of installed DSH plugin APIs, BB provider/model metadata, safe auth-method status, and relevant Nixfiles references. The initial inventory and mapping were recorded before DSH profile changes.
2. Copy the account-switch behavior of the owned BB AI Accounts plugin first as owned DSH configuration over DSH's same-version first-party ACP subagent API. Bind each named Codex account to its existing `CODEX_HOME`, pin the child model to Luna, and keep the stock `web` and `desktop` profiles unchanged.
3. First implement useful portable behavior: relevant Nixfiles/BB instructions as DSH skills, safe Secret CLI metadata access, Jujutsu/repository workflow, bounded Tokitoki reads, model/provider config if supported, and explicit sandbox/approval defaults. Classify BB-only UI and unsupported provider auth as platform boundaries with exact evidence.
4. Launch only the migration profile, verify plugin loading, shell/files in a disposable directory, local web response, available model/auth behavior without exposing values, and enabled MCP/tool paths. Do not test by editing existing repositories.
5. Update every row and record commands/results, remaining user actions, normal-use commands, and rollback/removal steps. Do not alter BB, global package versions, or unrelated Nix inputs.

## Remaining mapping and gaps

| BB capability | BB implementation | DSH replacement | status | notes |
|---|---|---|---|---|
| Providers and models | Codex, Claude Code, Pi, Cursor ACP, OpenCode ACP, and AI Accounts | DSH profile currently uses shipped DeepSeek model configuration; host CLI stays available through Bash | partial | No subscription-backed Codex model adapter. DSH provider credential status and a real model request still need an authenticated UI session |
| Codex subscription accounts | Three Codex account profiles using ChatGPT sign-in | None | not replicated | Installed DSH has no supported Codex OAuth adapter; do not copy auth or replace with API-key billing |
| OpenCode Go accounts | Three named account profiles | None | not replicated | No matching DSH account-isolation workflow has been implemented |
| Skills and agent instructions | BB registry and user/project instructions | DSH built-in instruction and skill filesystem plugins | partial | Existing Nix-managed skills should be discovered from `~/.agents/skills`; inspect resulting behavior in an authenticated session |
| MCP servers | Dadabase and Tokitoki | DSH first-party MCP client; Tokitoki stdio configured | partial | Tokitoki tool call still needs verification. Dadabase endpoint is unknown outside BB |
| Browser and terminal | BB browser automation and persistent scoped terminals | DSH Bash plus web search/fetch | partial | Browser control/DOM automation and persistent terminal parity are not established |
| Git and JJ | BB environment providers and Jujutsu plugin | DSH Bash tools plus existing `jj` skill | partial | No worktree lifecycle or BB environment-picker UI replacement |
| Planning and persistence | BB plan/goal, forks/rewind, local sessions | DSH plan/goal, subagents, JSONL persistence | partial | Core APIs are present; cross-provider import/rewind parity is unverified |
| Permissions and approvals | Provider-specific permission modes | DSH built-in read-only/workspace-write/danger-full-access presets; default asks | partial | DSH's `workspace-write` plus approval `ask` is the retained default. No global permission broadening was applied |
| Hooks, commands, prompts | BB plugin commands; prompts plugin disabled | DSH built-in commands and skill command workflows | partial | BB command-palette/shortcut registration is not available through the verified DSH API |
| BB-specific app UI | Sidebar, annotations, tabs, theme, notes, diff status, notifications, embedded previews | No verified DSH extension API for these surfaces | not replicated | These capabilities remain platform boundaries rather than visual approximations |

## Changes made

- Created isolated DSH profile `bb-migration` from the shipped `web` template, excluding the `dshmarket` dependency. Existing `web` and `desktop` profiles were left unchanged.
- Added the DSH first-party MCP client at exact version `0.2.0-rc.2` to the isolated profile, without upgrading DSH or other packages.
- Added the exact-version DSH first-party ACP subagent package and pinned Codex ACP runtime to the isolated profile; DSH and unrelated package versions were not upgraded.
- Added owned account bindings for `personal`, `work`, and `alex2` to `assets/dsh/bb-migration.patch.yml`. Each selects its existing account home through `CODEX_HOME`, pins `CODEX_CONFIG` to `gpt-6-luna`, and rejects ACP permission prompts. Added owned Tokitoki MCP registration and launch helper.
- Set the migration profile's default LLM route to the installed `openai-codex` Pi AI route at `gpt-6-luna`. This route's OAuth credentials are stored by DSH independently; no Pi or BB auth files were copied.
- Kept the migration document in Nixfiles at `assets/dsh/BB-MIGRATION.md` and linked it from `~/.dsh/BB-MIGRATION.md`.
- No BB settings, plugins, servers, credentials, or unrelated Nix configuration were changed. No DSH credential file was read.

## Verification performed

| Check | Result |
|---|---|
| BB inventory with `bb plugin list --json` and provider/MCP metadata | Passed; 62 plugins, 52 enabled, 10 disabled; Tasks and Automations recorded deferred |
| DSH version and installed profile/package inspection | Passed; `@deepseek-ai/dsh@0.2.0-rc.2`; stock profiles unchanged |
| DSH config schema under Node `v22.23.3` | Passed with non-fatal schema warnings about loader-tree carriers |
| Isolated profile dependency install | Passed; installed exact `dsh-mcp-client@0.2.0-rc.2`, `dsh-subagent-acp@0.2.0-rc.2`, and `codex-acp@2.0.1`; no DSH or unrelated package upgrade |
| Owned DSH patch composition | Passed; config dump contains all three ACP providers/tools, Tokitoki, `openai-codex`, and `gpt-6-luna`; output was checked by presence flags only |
| Owned plugin load and profile startup | Passed; DSH bound localhost:3081, printed its one-time route, and showed no startup error in foreground output. Existing port 3080 server was not touched |
| HTTP response | Passed; unauthenticated root returned 401 by design; process stopped afterward |
| Repeat launch/cleanup | A duplicate startup hit `EADDRINUSE` while the prior migration test listener remained active; its working directory identified it as the migration process, which was stopped. Port 3081 is now free |
| Tokitoki MCP direct protocol | Passed separately; connected to local `tokitoki mcp`, discovered 14 tools, and completed one read-only `budgets_status` call. No report payload was copied into this document |
| DSH model turn, shell/file through an agent, Codex ACP subagent run | Not run; requires DSH OAuth/user auth and would spend provider tokens. User instruction says any Codex subagent test must use Luna; configuration pins Luna, but no model request was made |
| Existing DSH web server and BB setup | Left running/unchanged; migration verification used port 3081 |

## Normal use and rollback

From this checkout, start the isolated migration profile with:

```sh
./assets/dsh/start-bb-migration
```

This uses Node `v22.23.3`, starts port 3081, and opens a fresh tokenized browser route. To keep the server in the foreground without opening a browser, add `--no-open`. A Chrome app shortcut can open the authenticated DSH page after its first launch, but it cannot start the local server or mint the new process token; run the launcher first after each server stop.

The model selector defaults to Codex via DSH's `openai-codex` route at Luna. Sign into that route through DSH's own authorization flow when prompted. The three separate ACP tools are `subagent_codex_personal`, `subagent_codex_work`, and `subagent_codex_alex2`; each invokes Codex ACP at Luna using the corresponding existing Codex home. ACP permissions reject by default. A child run returns only its final answer and does not continue the BB provider thread.

To roll back only migration changes, stop the profile process, remove `~/.dsh/profiles/bb-migration`, remove the `~/.dsh/BB-MIGRATION.md` symlink, and delete the three `assets/dsh/` migration files in this change. This leaves the original `web`, `desktop`, and BB installations intact.

## Remaining user actions

- Open the migration profile and sign in to DSH's `openai-codex` route using DSH's own authorization flow. DSH does not reuse credentials from Pi, BB account homes, or Codex ACP processes.
- The `work` Codex home was reported as not logged in during safe auth-status inspection. If it is still needed, sign it in yourself using `CODEX_HOME="$HOME/.local/share/bb-ai-accounts/codex/work" codex login`; no credential file needs to be copied. Personal and `alex2` homes were reported as logged in, but their auth state was not rechecked during implementation.
- After login, run one disposable DSH shell/file operation, one Tokitoki report query, and (if desired) one Codex ACP child using Luna. These remain unverified because no authenticated model call was made.
- Claude Code, Cursor ACP, OpenCode ACP, and OpenCode Go account switching remain unimplemented. Codex ACP account selection is partial; persistent sessions, model catalog editing, and usage history remain gaps.
