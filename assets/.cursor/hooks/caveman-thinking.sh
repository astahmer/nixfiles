#!/usr/bin/env bash
# sessionStart: inject terse caveman style for thinking blocks
set -euo pipefail

cat <<'EOF'
{
  "additional_context": "Thinking blocks: ultra-terse caveman bullets. Max 3 short lines. No articles, filler, or hedging. Same caveman style as replies but NO OUGABOUGA in thoughts. Overrides verbose communication rules inside thinking only."
}
EOF
