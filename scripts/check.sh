#!/usr/bin/env bash
set -euo pipefail

root="${1:-$PWD}"
if [ ! -f "$root/flake.nix" ]; then
  echo "nixfiles-check: no flake.nix found at $root" >&2
  exit 1
fi

cd "$root"

if ! command -v jj >/dev/null 2>&1; then
  echo "nixfiles-check: jj is required for revision and whitespace checks" >&2
  exit 1
fi
nix_files="$(jj file list | rg '\.nix$' || true)"
if [ -n "$nix_files" ]; then
  while IFS= read -r nix_file; do
    [ -n "$nix_file" ] || continue
    [ -f "$nix_file" ] || continue
    nixfmt --check "$nix_file"
    deadnix --fail "$nix_file"
  done <<< "$nix_files"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "nixfiles-check: bun is required for script regression tests" >&2
  exit 1
fi
bun test scripts/update-pins.test.ts
bun test assets/pi/extensions/queue-subagent.test.ts
bun test assets/pi/extensions/free-model-retry-policy.test.ts
node assets/t3code/test-seed-provider-instances.mjs
assets/codex/test-normalize-root-model.sh

if ! command -v jq >/dev/null 2>&1; then
  echo "nixfiles-check: jq is required for configuration contract checks" >&2
  exit 1
fi

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
  and .codexAccountNamespaces == {"codex-perso": "@main"}
  and ((.codexAccounts // []) | length == 0)
  # This is the checked-in OpenCodex 2.63.0 visibility snapshot for the
  # configured providers. A catalog refresh that intentionally changes it
  # should update the template and these assertions together.
  and (.disabledModels | length == 170)
  and ((.disabledModels | length) == (.disabledModels | unique | length))
  and (.providers.commandcode.defaultModel == "gpt-6-luna")
  and (.providers.commandcode.models | contains(["gpt-6-luna", "gpt-6-sol"]))
  and (.subagentModels | index("gpt-6-luna") != null)
  and (.disabledModels | index("gpt-6-astra") == null)
  and (.disabledModels | index("gpt-6-sol") == null)
  and (.disabledModels | index("gpt-6-luna") == null)
  and (.disabledModels | index("opencode-go-alex/deepseek-v4-flash-vision-exp") != null)
  and (.disabledModels | index("opencode-go-manu/gpt-5.6-luna") != null)
  and (.disabledModels | index("opencode-go-mathias/qwen3.8-max") != null)
' assets/opencodex/config.template.json >/dev/null
jq -e '
  .secrets["opencodex-codex-perso-email"].env == "OPENCODEX_CODEX_PERSO_EMAIL"
  and .secrets["opencodex-codex-perso-email"].type == "login"
  and .secrets["opencodex-codex-alex2-email"].env == "OPENCODEX_CODEX_ALEX2_EMAIL"
' .secret.json >/dev/null
jq -e '
  .poll.enabled == true
  and ([.poll.extraKeys[].id] | sort == [
    "opencode-go-alex",
    "opencode-go-manu",
    "opencode-go-mathias"
  ])
  and ([.poll.extraKeys[].provider] | all(. == "opencode-go"))
  and ([.poll.extraKeys[].key] | sort == [
    "__TOKITOKI_SECRET_OPENCODE_GO_ALEX__",
    "__TOKITOKI_SECRET_OPENCODE_GO_MANU__",
    "__TOKITOKI_SECRET_OPENCODE_GO_MATHIAS__"
  ])
  and ((.budgets.accounts // {}) | has("openrouter") | not)
  and ((.ui.previewHidden // []) | index("openrouter") | not)
' assets/tokitoki/config.template.json >/dev/null
jq -e '
  ["devenv", "qmd", "jjw", "secret-cli"] as $required
  | ([.updates[].name] as $names | ($required - $names) | length == 0)
' scripts/update-pins.json >/dev/null
assets/opencodex/test-strip-legacy-base-url.sh
if command -v ocx >/dev/null 2>&1; then
  ocx config validate assets/opencodex/config.template.json --json >/dev/null
fi

if ! command -v ast-grep >/dev/null 2>&1 || ! command -v oxlint >/dev/null 2>&1; then
  echo "nixfiles-check: ast-grep and oxlint are required for lint fixtures" >&2
  exit 1
fi
emilint_source="${EMILINT_SOURCE:-$(nix eval --raw --impure --expr 'builtins.toString ((builtins.getFlake (toString ./.)).inputs.emilint)')}"
if [ ! -d "$emilint_source" ]; then
  echo "nixfiles-check: pinned emilint source is unavailable at $emilint_source" >&2
  exit 1
fi

(
  cd "$emilint_source"
  ast-grep test -c sgconfig.yml --skip-snapshot-tests
  ast-grep test -c profiles/effect/sgconfig.yml --skip-snapshot-tests

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
    oxlint.test.config.json \
    tests/oxlint/valid-reflect.ts \
    tests/oxlint/invalid-reflect.ts
  oxlint_fixture \
    oxlint.test.config.json \
    tests/oxlint/valid-broad-object.ts \
    tests/oxlint/invalid-broad-object.ts
  oxlint_fixture \
    profiles/effect/oxlint.test.config.json \
    profiles/effect/tests/oxlint/adapters/valid-run.ts \
    profiles/effect/tests/oxlint/domain/invalid-run.ts
)

jj --color never diff --git | awk '
  /^\+\+\+ b\// { file = substr($0, 7); next }
  /^\+\+\+/ { next }
  /^\+/ && /[[:blank:]]+$/ {
    printf "nixfiles-check: added line in %s has trailing whitespace\n", file > "/dev/stderr"
    failed = 1
  }
  /^\+[[:space:]]*(<<<<<<<|=======|>>>>>>>)([[:space:]]|$)/ {
    printf "nixfiles-check: added conflict marker in %s\n", file > "/dev/stderr"
    failed = 1
  }
  END { exit failed }
'
if command -v swift >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  secret_cli_root="$(nix eval --raw --impure --expr 'builtins.toString ((builtins.getFlake (toString ./.)).inputs.secret-cli)')"
  SECRET_SOURCE_ROOT="$secret_cli_root/secret" assets/bitwarden/test-secret.sh
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
