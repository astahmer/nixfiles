#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT

cat > "$temporary_dir/input.toml" <<'EOF'
model = "codex-perso/gpt-6-luna"
model_catalog_json = "legacy-root-catalog"

[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
EOF

cat > "$temporary_dir/expected.toml" <<'EOF'
model = "gpt-6-luna"


[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
EOF

awk -f "$repo_root/assets/codex/normalize-root-model.awk" "$temporary_dir/input.toml" > "$temporary_dir/output.toml"
diff -u "$temporary_dir/expected.toml" "$temporary_dir/output.toml"

cat > "$temporary_dir/input.toml" <<'EOF'
[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
EOF

cat > "$temporary_dir/expected.toml" <<'EOF'
model = "gpt-6-luna"
[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
EOF

awk -f "$repo_root/assets/codex/normalize-root-model.awk" "$temporary_dir/input.toml" > "$temporary_dir/output.toml"
diff -u "$temporary_dir/expected.toml" "$temporary_dir/output.toml"
