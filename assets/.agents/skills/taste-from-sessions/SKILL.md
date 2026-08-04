---
name: taste-from-sessions
description: Infer and maintain undocumented user coding preferences from local agent sessions. Use for initial taste backfill or a selective update after a completed task.
argument-hint: "[repo-path]"
---

# Taste From Sessions

Maintain the repository's `AGENTS_TASTE.md` from durable preferences communicated in local agent sessions. Do not duplicate preferences already documented in `AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions, or other agent-visible project files.

## Two modes

- **Initial backfill:** inspect bounded history from installed agent harnesses, derive undocumented preferences, and create or update `AGENTS_TASTE.md`.
- **Post-session update:** inspect only the newly completed relevant session and update the file only when a new durable preference was communicated. Skip ordinary task requirements, one-off choices, assistant suggestions, tool output, and repeated existing rules.

## Contract

- Use the current repository by default (accept a path when supplied); read applicable repository instructions and existing `AGENTS_TASTE.md` first.
- Work locally and read-only except for `AGENTS_TASTE.md`; never authenticate, use the network, run mutating provider commands, or inspect unrelated repositories.
- Read bounded excerpts only. Never recursively scan all of `$HOME` or read credentials, tokens, environment dumps, attachments, screenshots, binaries, or unrelated files.
- Associate a session with the repository only through project/cwd metadata, an unambiguous repository path, provider-directory identity, or a referenced file under the repository. Skip ambiguous records.
- Consider person-authored requests, corrections, approvals, repeated choices, edits, and final state. Ignore generated output and tool chatter.
- Never copy prompts, source, secrets, paths, URLs, names, session IDs, or personal data into taste.

## Session discovery

Check likely local roots for installed harnesses without assuming any format:

- Codex: `~/.codex/sessions`, history, archived sessions
- Claude Code: `~/.claude/projects`, transcripts, history
- Cursor: `~/.cursor/projects`, chats, transcripts
- Copilot/VS Code: workspace storage
- OpenCode: `~/.local/share/opencode`, `~/.config/opencode`, state
- Pi, Cline, Roo Code, Aider, Continue, and T3 Code: their clearly named local session roots

Prefer text or JSON exports. Inspect SQLite read-only when supported; otherwise skip it. Keep excerpts bounded and avoid unbounded history dumps.

## Evidence

Persist only rules backed by explicit or repeated evidence (confidence `0.8+`):
explicitly stated or accepted preferences, or accepted implementations
repeated across sessions. Generalize durable rules, merge duplicates, and
preserve intentional scope differences. Remove a rule only for explicit
contradiction or clear obsolescence. Prefer fewer high-confidence rules over
speculation.

## Writing rules

- One bullet per rule, one line, imperative and specific to this user.
- Write or rewrite technical text with the rules of ASD-STE100 Simplified Technical English so it is clear, unambiguous, and free of AI slop. One word one meaning, simple tenses, active voice, condition before command.

If no new durable preference was communicated, do nothing.
