---
name: feature-plan
description: Creates structured feature plan documents from a template. Use when user asks to create a plan, feature plan, spec, design doc, or "let's plan X".
---

# Feature Plan

Creates `{project}/plans/{feature-name}.md` from the template at `assets/.agents/skills/feature-plan/_template.md`.

## Workflow

1. **Get feature name** — ask user for kebab-case name (e.g. `dark-mode`, `auth-flow`).
2. **Read template** — load `assets/.agents/skills/feature-plan/_template.md` from this repo.
3. **Gather content** — for each section, either ask the user or synthesize from context already discussed. Prioritize asking over guessing.
4. **Write plan** — create `{project-root}/plans/{feature-name}.md` with all sections filled.

## Sections to fill

| Section | Approach |
|---------|----------|
| Context | Ask what exists today, relevant architecture, constraints |
| Goal | Ask for one-sentence outcome |
| What | Define scope and shape of the feature |
| Why | Ask what pain/opportunity this addresses |
| How | Conceptual model, operations, tech choices, architecture |
| What this allows | Capabilities gained |
| What this does not allow | Out-of-scope / deliberate limitations |
| UI & UX | Ask for mockup description or sketch |
| Data model | Ask if new data structures are needed |
| Implementation steps | Break into ordered steps |
| Open questions | Ask what's still undecided |
| Acceptance criteria | Ask for pass/fail conditions |
| Decisions log | Fill as decisions are made |

## Output conventions

- Use kebab-case filenames.
- Start with `# {Feature name} plan` heading.
- Keep sections from template; remove empty ones.
- Use mermaid diagrams for architecture/data when helpful.
- Append to decisions log as the session progresses.
