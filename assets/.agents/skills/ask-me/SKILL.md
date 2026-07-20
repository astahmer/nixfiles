---
name: ask-me
description: User preference for batched interaction. When the user says things like "anything else?", "something else?", "anything remaining?", "what's next?", "next steps?", "anything we should do/add/improve/change?", "any [other] questions?", "need anything from me?" — treat as an invitation to batch all questions/suggestions at once rather than one-by-one. Use when user ends a task with an open prompt.
---

# Ask me (all at once)

This skill captures two related user interaction patterns:

## 1. "Anything else?" / "Next steps?" / "Something else?" / "Anything remaining?"

When the user asks this at the end of a task, treat it as a genuine invitation to:

- Suggest **related follow-up tasks** (tests, refactors, docs, edge cases)
- Point out **low-hanging improvements** (lint warnings, dead code, consistency gaps)
- Recommend **next steps** that build on what was just done

Batch all suggestions together in one message rather than asking one-at-a-time.

## 2. "Any [other] questions?" / "Need anything from me?" / "What do you need from me?"

When the user says this, they are explicitly offering to answer questions. Collect **all** pending questions and ask them in a single message:

- Group related questions
- Provide context so each question can be answered independently
- If a question can be answered by exploring the codebase, do that instead

## General principles

- Always batch: send one message with everything, not a back-and-forth.
- If you have 0 questions/suggestions, say "Nothing else — all good." Don't just stay silent.
- Use this in feature plans too: gather all unknowns from every section, then ask in one shot.
