#!/usr/bin/env bash
set -euo pipefail

root="${1:-$PWD}"
if [ ! -f "$root/flake.nix" ]; then
  echo "nixfiles-check: no flake.nix found at $root" >&2
  exit 1
fi

cd "$root"

nix_files="$(git ls-files '*.nix')"
if [ -n "$nix_files" ]; then
  while IFS= read -r nix_file; do
    [ -n "$nix_file" ] || continue
    [ -f "$nix_file" ] || continue
    nixfmt --check "$nix_file"
    deadnix --fail "$nix_file"
  done <<< "$nix_files"
fi

if command -v jq >/dev/null 2>&1; then
  jq -e '
    .accountPoolStrategy == "quota"
    and .codexAccountPickerEnabled == true
    and (.providers | keys | contains([
      "opencode-go-alex",
      "opencode-free",
      "opencode-go-mathias"
    ]))
    and .providers["opencode-go-alex"].apiKey == "$OPENCODEX_OPENCODE_GO_API_KEY"
    and .providers["opencode-go-mathias"].apiKey == "$OPENCODEX_OPENCODE_GO_MATHIAS_KEY"
    and .codexAccountNamespaces == {
      "codex-perso": "@main",
      "codex-work": "chatgpt-1786023688396",
      "codex-alex2": "chatgpt-1788600942946"
    }
    and ([.codexAccounts[].id] | sort == [
      "chatgpt-1786023688396",
      "chatgpt-1788600942946"
    ])
    and ([.codexAccounts[].isMain] | all(. == false))
    and ([.codexAccounts[].email] | all(startswith("$OPENCODEX_CODEX_")))
    # This is the checked-in OpenCodex 2.42.0 visibility snapshot for the
    # configured providers. A catalog refresh that intentionally changes it
    # should update the template and these assertions together.
    and (.disabledModels | length == 161)
    and ((.disabledModels | length) == (.disabledModels | unique | length))
    and (.disabledModels | index("opencode-go-alex/deepseek-v4-flash-vision-exp") != null)
    and (.disabledModels | index("opencode-go-manu/gpt-5.6-luna") != null)
    and (.disabledModels | index("opencode-go-mathias/qwen3.8-max") != null)
  ' assets/opencodex/config.template.json >/dev/null
  jq -e '
    .secrets["opencodex-codex-perso-email"].env == "OPENCODEX_CODEX_PERSO_EMAIL"
    and .secrets["opencodex-codex-perso-email"].type == "login"
    and .secrets["opencodex-codex-work-email"].env == "OPENCODEX_CODEX_WORK_EMAIL"
    and .secrets["opencodex-codex-alex2-email"].env == "OPENCODEX_CODEX_ALEX2_EMAIL"
  ' .secret.json >/dev/null
  if command -v ocx >/dev/null 2>&1; then
    ocx config validate assets/opencodex/config.template.json --json >/dev/null
  fi
fi

if command -v ast-grep >/dev/null 2>&1 && command -v oxlint >/dev/null 2>&1; then
  (
    cd assets/.agents/skills/antislop
    ast-grep test -c sgconfig.yml --skip-snapshot-tests
  )
  (
    cd assets/.agents/skills/effect-antislop
    ast-grep test -c sgconfig.yml --skip-snapshot-tests
  )

  oxlint_fixture() {
    local config="$1"
    local valid="$2"
    local invalid="$3"
    oxlint --config "$config" --quiet "$valid"
    if oxlint --config "$config" --quiet "$invalid"; then
      echo "nixfiles-check: expected Oxlint failure for $invalid" >&2
      return 1
    fi
  }

  oxlint_fixture \
    assets/.agents/skills/antislop/oxlint.test.config.json \
    assets/.agents/skills/antislop/tests/oxlint/valid-reflect.ts \
    assets/.agents/skills/antislop/tests/oxlint/invalid-reflect.ts
  oxlint_fixture \
    assets/.agents/skills/antislop/oxlint.test.config.json \
    assets/.agents/skills/antislop/tests/oxlint/valid-broad-object.ts \
    assets/.agents/skills/antislop/tests/oxlint/invalid-broad-object.ts
  oxlint_fixture \
    assets/.agents/skills/effect-antislop/oxlint.test.config.json \
    assets/.agents/skills/effect-antislop/tests/oxlint/adapters/valid-run.ts \
    assets/.agents/skills/effect-antislop/tests/oxlint/domain/invalid-run.ts
else
  echo "nixfiles-check: skipping antislop fixtures (ast-grep or oxlint not on PATH)" >&2
fi

git diff --check
if command -v swift >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  assets/bitwarden/test-secret.sh
  assets/bitwarden/test-completions.sh
  assets/bitwarden/test-shell.sh
  if [ -x assets/bitwarden/node_modules/.bin/tsc ]; then
    (cd assets/bitwarden && bun run typecheck)
  else
    echo "nixfiles-check: skipping secret typecheck (run 'bun install' in assets/bitwarden first)" >&2
  fi
elif command -v bun >/dev/null 2>&1; then
  SECRET_IMPL=ts assets/bitwarden/test-secret.sh
  assets/bitwarden/test-completions.sh
  assets/bitwarden/test-shell.sh
  if [ -x assets/bitwarden/node_modules/.bin/tsc ]; then
    (cd assets/bitwarden && bun run typecheck)
  else
    echo "nixfiles-check: skipping secret typecheck (run 'bun install' in assets/bitwarden first)" >&2
  fi
else
  echo "nixfiles-check: skipping secret regression tests (bun not on PATH)" >&2
fi
nix flake check --no-build "$root"
