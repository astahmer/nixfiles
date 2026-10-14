---
name: jj-merge-workspaces
description: Superseded — load jj-linearize instead. The workspace/thread consolidation procedure (linearize everything above a base, one branch, spine, too many heads) now lives in one skill with a deterministic script; this entry only routes you there so there is a single procedure to follow.
---

# Superseded by jj-linearize

This skill's procedure moved into `jj-linearize`, together with the retired
`jj-history-consolidation` recipes (see its `consolidation.md` for the
exploded-graph, duplicate-copy and live-workspace cases).

Load `jj-linearize` and follow it; use `jj-recover` when an operation already failed
or the graph is divergent.
