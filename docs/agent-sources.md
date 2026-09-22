# Agent sources

The deployed agent tree is assembled from three ownership layers:

1. `inputs.agents` supplies the portable project contract and reusable skills.
2. `inputs.emilint` supplies executable antislop and Effect rule assets.
3. `assets/.agents/` supplies the Nix-local global contract and overlays such
   as machine skills, hooks, instructions, and memory.

`modules/agents.nix` assembles those layers before Home Manager deploys them
to `~/.agents`. Projects outside Nix should consume `agents` directly and add
`emilint` as a package dependency.

## Transition state

The inputs currently point at the remote commits that existed before this
local migration. The local `agents` and `emilint` worktrees contain the next
source versions but have not been pushed.

After those source commits are published:

1. refresh both inputs in one lockfile change:

   ```bash
   rtk nix flake lock --update-input agents --update-input emilint
   ```

2. run the Home Manager agent-tree check and inspect the assembled skill list;
3. remove duplicate portable skill directories from `assets/.agents/skills`;
4. keep only machine-specific overlays and compatibility fixtures in
   `nixfiles`.

Until that lock update, `nixfiles-check` still exercises the checked-in
antislop and Effect compatibility fixtures. Once the published emilint source
is pinned, point that check at the package-owned fixtures or remove the
duplicate snapshots.

Do not add a Git submodule. The lockfile pins the source revisions, while this
module owns the small amount of composition needed for machine deployment.
