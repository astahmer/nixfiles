---
name: tokitoki-usage
description: "Read or refresh the always-visible Tokitoki usage indicator in BB."
---

# Tokitoki Usage in BB

The compact indicator is fixed to the right edge of each wide BB app window.
Click it to see quota windows grouped by provider and account. It reads
Tokitoki's `widget-payload` command and never reads provider credentials.

The plugin uses its **Tokitoki executable** setting. Nix sets it to the
flake-pinned Tokitoki package. It reads cached data so opening the overlay does
not scan session histories. Tokitoki's own poll and menu-bar refresh settings
control the freshness of that cache.
