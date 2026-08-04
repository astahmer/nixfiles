---
name: taste-from-sessions
description: Infer and maintain repository-specific coding preferences from prior sessions created by mainstream coding-agent harnesses such as Codex, Cursor, Claude Code, GitHub Copilot, OpenCode, Cline, Roo Code, Aider, Continue, and T3 Code. Use when asked to learn taste from history, bootstrap or refresh taste files, import preferences from another agent, or inspect past sessions for recurring user choices.
argument-hint: "[repo-path] [--since <date>] [--dry-run]"
---

# Taste From Sessions

Build a conservative, evidence-backed taste package from past coding-agent sessions. Use the currently selected model for all interpretation. Do not invoke a harness-specific taste command, a custom taste model, a remote taste service, or any provider API.

## Contract

- Treat the current repository as the default scope. If `$ARGUMENTS` contains a repository path, use it instead.
- Read the repository's agent instructions before inspecting history. Follow its tool, shell, and VCS conventions.
- Do not assume a provider is installed or that its storage format is stable. Discover files, inspect small samples, and skip unknown formats rather than guessing.
- Read local files only. Never authenticate, make network requests, call provider CLIs that could mutate state, or inspect another repository unless explicitly given its path.
- Do not read credentials, tokens, environment dumps, attachments, screenshots, binary files, or arbitrary files outside the session records needed for this task.
- Do not copy session transcripts, source code, file contents, issue text, names, paths, URLs, secrets, or personal data into taste files. Record only generalized preferences.
- Do not treat an agent suggestion, tool output, generated patch, or assistant claim as a preference until the person explicitly accepted, requested, repeated, edited, or preserved it.
- Prefer a smaller set of high-confidence learnings over speculative coverage.

## Output format

Use the existing `.commandcode/taste/` package if present. Preserve its layout and style:

```text
.commandcode/taste/
├── taste.md
├── <category>/taste.md
└── ...
```

The root file may contain a `See [category/taste.md](category/taste.md)` link. Category files use a `# Taste` heading and optional `## <topic>` headings. Each learning is one bullet in this form:

```text
- <generalized preference>. Confidence: <0.0-1.0>
```

Use stable, human-readable categories such as `nix`, `terminal`, `testing`, `typescript`, `architecture`, `workflow`, or `communication`. Keep the root file's category links consistent with the files on disk.

## Workflow

### 1. Establish scope and baseline

1. Resolve the repository root and read `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, and other applicable instruction files.
2. Read every existing `.commandcode/taste/**/*.md` file. Treat existing learnings as baseline evidence, not as proof that new evidence exists.
3. Note the current date and any `--since` boundary. Default to recent sessions plus enough older sessions to identify repeated behavior; do not ingest an unbounded history dump.
4. If `--dry-run` is present, never write files.

### 2. Discover session records

Search only likely local session roots. Expand `~` and use the platform's home directory rather than hard-coding a username. Start with these candidates, then inspect adjacent directories only when their names clearly indicate session, transcript, chat, task, conversation, history, or message data:

| Harness | Candidate roots |
|---|---|
| Codex | `~/.codex/sessions`, `~/.codex/history.jsonl`, `~/.codex/archived_sessions` |
| Claude Code | `~/.claude/projects`, `~/.claude/transcripts`, `~/.claude/history.jsonl` |
| Cursor | `~/.cursor/projects`, `~/.cursor/chats`, `~/.cursor/agent-transcripts` |
| GitHub Copilot / VS Code | `~/.config/Code/User/workspaceStorage`, `~/Library/Application Support/Code/User/workspaceStorage`, `~/.vscode` |
| OpenCode | `~/.local/share/opencode`, `~/.config/opencode`, `~/.local/state/opencode` |
| Cline | `~/.cline`, `~/.config/Code/User/globalStorage/*cline*` |
| Roo Code | `~/.roo`, `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline` |
| Aider | `~/.aider.chat.history.md`, `~/.aider` |
| Continue | `~/.continue`, `~/.config/Code/User/globalStorage/continue.continue` |
| T3 Code and other harnesses | `~/.t3code`, `~/.config/t3code`, `~/.local/share/t3code`, `~/.config`, `~/.local/share` only with a narrow name filter |

The Cline entry contains a provider-specific identifier; if it does not exist, search the same parent directory for a directory whose name contains `cline`. Do not recursively scan all of `$HOME` blindly. Use file names, directory names, modification dates, and small text previews to identify records.

For each candidate record, determine whether it belongs to the target repository using, in order:

1. An explicit project, workspace, repository, or cwd field.
2. A path or URI embedded in session metadata.
3. A provider directory whose encoded name unambiguously matches the repository root.
4. A referenced file path that resolves under the repository.

If ownership is ambiguous, exclude the record. A session that merely mentions the repository name is not enough.

Recognize common record forms: JSONL, JSON, Markdown, SQLite, SQLite WAL metadata, and nested text files. Prefer the provider's text export or JSON metadata. For SQLite, inspect schema and query only session/message tables if a read-only SQLite tool is available; otherwise skip it. Never run a provider's migration or repair command.

### 3. Extract preference evidence

Read bounded excerpts, not entire histories. Focus on person-authored messages, requested changes, corrections, approvals, rejected suggestions, repeated commands, edits after generated patches, and final repository state. Ignore greetings, one-off domain requirements, generated output, tool chatter, and preferences stated only by the assistant.

Classify evidence:

- **Explicit**: “always use…”, “prefer…”, “don’t…”, or a direct correction.
- **Accepted change**: the person asks for or keeps a specific implementation choice.
- **Repeated behavior**: the same choice appears in at least two independent sessions or three turns.
- **Weak signal**: one unconfirmed choice, a temporary experiment, or a requirement limited to one task.

Convert evidence into a short, durable rule. Generalize project-specific names and values unless the value itself is the durable preference. For example, record “prefers Nix-managed configuration” rather than a single filename.

Use this confidence guide:

- `0.9`: explicit and repeated, or explicit plus accepted implementation.
- `0.8`: accepted implementation repeated across sessions.
- `0.7`: clear repeated behavior with limited explicit confirmation.
- `0.5-0.6`: one strong but unconfirmed signal; normally do not persist it.
- Below `0.5`: do not write it.

When harnesses disagree, preserve separate scoped rules only if the difference is clearly intentional; otherwise keep the more recent explicit preference and lower confidence. Do not infer preferences from model choice, token usage, typing speed, or a harness's default behavior.

### 4. Reconcile with existing taste

Before writing, produce an internal table with: proposed rule, category, supporting sessions, evidence type, confidence, and whether it is new, an update, a duplicate, or contradicted. Do not include raw transcript text in the table sent to the model beyond the minimum excerpt needed for interpretation.

- Merge semantically equivalent rules instead of adding duplicates.
- Update confidence only when new evidence changes it; do not churn wording for stylistic reasons.
- Remove a rule only when there is explicit contrary evidence or it is clearly obsolete.
- Keep confidence within `0.0` and `1.0`.
- Never write a rule about secrets, credentials, private people, transient incidents, or an individual session.

### 5. Write and verify

Unless `--dry-run` is set, update only the necessary `.commandcode/taste/**/*.md` files. Keep edits minimal and preserve unrelated content. Create a category file only when at least one durable learning belongs there. Ensure the root index links every category file and contains no dangling links.

After writing:

1. Re-read all changed taste files.
2. Check headings, bullets, confidence values, UTF-8 text, and relative links.
3. Confirm no raw prompts, code excerpts, secrets, absolute home paths, session IDs, or provider-specific private identifiers were written.
4. Report a concise summary of categories changed, learnings added or updated, sessions considered by harness and count, and anything skipped due to ambiguity or unreadable formats.

Do not claim that no preference exists merely because one harness was unavailable. Distinguish “not found”, “not readable”, “not associated with this repository”, and “insufficient evidence”.
