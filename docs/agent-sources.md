# Agent sources

The deployed agent tree is assembled from three sources:

1. `inputs.agents` (the `astahmer/AGENTS` repository) is the base: the
   user-global `AGENTS.md` contract and the portable skill set.
2. `inputs.emilint` supplies executable antislop and Effect rules, their
   companion skills, configs, and fixtures.
3. `assets/.agents/` overlays machine-specific skills, preferences, and memory
   on top of the base.

`modules/agents.nix` copies the base first, overlays `assets/.agents`, then adds
the emilint and calldiff skills, and deploys the result to:

- `~/.agents` (canonical tree; `AGENTS.md` + `skills/`)
- `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`,
  `~/.config/opencode/AGENTS.md`, and
  `~/.copilot/instructions/copilot.instructions.md` (same contract per harness)
- `~/.copilot/skills` → `~/.agents/skills`
- `~/.cursor/rules` (the Nix-local condensed rule files)

`modules/agents.nix` assembles those layers before Home Manager deploys them
to `~/.agents`. Projects outside Nix should consume `agents` directly and add
`emilint` with pnpm:

```bash
pnpm add --save-dev astahmer/emilint#main
```

The consumer's pnpm lockfile records the exact emilint commit.

## Updating the sources

After changing either source repository, publish its source commit and refresh
both Nix inputs together:

   ```bash
   nix flake update agents emilint
   ```

Then check and realize the Home Manager configuration:

```bash
nixfiles-check
nix build --no-link '.#homeConfigurations.macbook.activationPackage'
```

`nixfiles-check` runs the lint fixtures from the pinned `inputs.emilint`
source. The checked-in `assets/.agents` tree keeps only machine-specific
overlays; the global contract, portable skills, and lint rules each have one
maintained source.

Do not add a Git submodule. The lockfile pins the source revisions, while this
module owns the small amount of composition needed for machine deployment.
