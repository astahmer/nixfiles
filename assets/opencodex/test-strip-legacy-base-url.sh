#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/strip-legacy-base-url.awk"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

cat > "$temporary_directory/input.toml" <<'EOF'
openai_base_url = "http://127.0.0.1:10100/v1"
[model_providers.custom]
openai_base_url = "http://127.0.0.1:10100/v1"
[model_providers.injected]
# Auto-injected by opencodex
openai_base_url = "http://127.0.0.1:10100/v1"
EOF
awk -f "$script" "$temporary_directory/input.toml" > "$temporary_directory/output.toml"
test "$(grep -c '^openai_base_url' "$temporary_directory/output.toml")" -eq 2
grep -q '^\[model_providers.custom\]$' "$temporary_directory/output.toml"
grep -q '^\[model_providers.injected\]$' "$temporary_directory/output.toml"

cat > "$temporary_directory/marked.toml" <<'EOF'
# Auto-injected by opencodex
openai_base_url = "http://127.0.0.1:10100/v1"
EOF
awk -f "$script" "$temporary_directory/marked.toml" > "$temporary_directory/marked-output.toml"
cmp "$temporary_directory/marked.toml" "$temporary_directory/marked-output.toml"

printf 'OpenCodex legacy proxy tests passed\n'
