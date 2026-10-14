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
node --test assets/dsh/supervise-web.test.mjs
bun test assets/codex/normalize-root-model.test.ts

if ! command -v jq >/dev/null 2>&1; then
  echo "nixfiles-check: jq is required for configuration contract checks" >&2
  exit 1
fi

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

if ! command -v ast-grep >/dev/null 2>&1 || ! command -v oxlint >/dev/null 2>&1; then
  echo "nixfiles-check: ast-grep and oxlint are required for lint fixtures" >&2
  exit 1
fi
# `nix flake archive` resolves the locked inputs without copying the working
# tree, which getFlake cannot do when .git holds a socket (fsmonitor).
flake_inputs="$(nix flake archive --json .)"
emilint_source="${EMILINT_SOURCE:-$(jq -r '.inputs.emilint.path' <<< "$flake_inputs")}"
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
  SECRET_SOURCE_ROOT="$(jq -r '.inputs["secret-cli"].path' <<< "$flake_inputs")/secret" \
    bun test assets/bitwarden/secret.test.ts
  assets/bitwarden/test-completions.sh
  assets/bitwarden/test-shell.sh
  if [ -x assets/bitwarden/node_modules/.bin/tsc ]; then
    (cd assets/bitwarden && bun run typecheck)
  else
    echo "nixfiles-check: skipping secret typecheck (run 'bun install' in assets/bitwarden first)" >&2
  fi
elif command -v bun >/dev/null 2>&1; then
  SECRET_IMPL=ts bun test assets/bitwarden/secret.test.ts
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
