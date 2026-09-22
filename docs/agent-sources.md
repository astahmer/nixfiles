# Agent sources

The deployed agent tree is assembled from three sources:

1. `inputs.agents` supplies reusable project skills.
2. `inputs.emilint` supplies executable antislop and Effect rules, their
   companion skills, configs, and fixtures.
3. `assets/.agents/` supplies the Nix-local global contract, machine-specific
   skills, hooks, instructions, and memory.

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
   rtk nix flake update agents emilint
   ```

Then check and realize the Home Manager configuration:

```bash
rtk nixfiles-check
rtk nix build --no-link '.#homeConfigurations.macbook.activationPackage'
```

`nixfiles-check` runs the lint fixtures from the pinned `inputs.emilint`
source. The checked-in `.agents` tree keeps only the Nix-local contract and
machine-specific skill overlays; portable skills and lint rules have one
maintained source each.

Do not add a Git submodule. The lockfile pins the source revisions, while this
module owns the small amount of composition needed for machine deployment.
