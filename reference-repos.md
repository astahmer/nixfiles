# Reference repositories

Local clones under `.references/` (gitignored). Refresh with the add-reference-repository skill.

| Name | URL | Path | Why |
| --- | --- | --- | --- |
| composto | https://github.com/mertcanaltin/composto | `.references/composto` | IR LOD (L0–L3), blast radius hooks, MCP tools — upstream source of truth for layer semantics |
| cachebro | https://github.com/glommer/cachebro | `.references/cachebro` | Raw read cache (reference only — we ship `composto-cachebro` instead) |
| composto-cachebro | (local) `assets/composto-cachebro` | n/a (versioned) | IR + session diff cache MCP — composto CLI + cachebro-style semantics |
