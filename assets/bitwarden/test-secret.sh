#!/usr/bin/env bash
# Fake-bw regression suite for the secret CLI (Swift port by default, TS
# reference implementation with SECRET_IMPL=ts).
# Self-contained: builds a fake bw/pbcopy, a temp HOME, and asserts behavior
# without touching a real vault or the network.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/assets/bitwarden/secret.ts"
bun_bin="${BUN:-bun}"
export FAKE_BUN_BIN="$bun_bin"
impl="${SECRET_IMPL:-swift}"
if [ "$impl" = "swift" ]; then
  swift build -c release --package-path "$root/packages/secret" >/dev/null
  swift_bin="$root/packages/secret/.build/release/secret"
  secret_bin0="$swift_bin"
  secret_bin1=""
else
  secret_bin0="$bun_bin"
  secret_bin1="$script"
fi
tmp="$(mktemp -d)"
trap '[ -n "${KEEP_TMP:-}" ] || rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/config/secret" "$tmp/proj/sub"

cat > "$tmp/bin/bw" <<'EOF'
#!/bin/sh
case "$1" in
  status)
    printf "%s\n" "status-env:${BW_SESSION:-EMPTY} reject=${FAKE_BW_REJECT_UNLOCK:-0}" >> "$FAKE_LOG"
    if [ "$BW_SESSION" = "session-token-123" ] && [ -z "$FAKE_BW_REJECT_UNLOCK" ]; then
      printf '%s' '{"status":"unlocked"}'
    else
      printf "%s" "$FAKE_BW_STATUS"
    fi
    ;;
  unlock)
    read -r _ || true
    printf "%s\n" "unlock-env:${BW_SESSION:-EMPTY}" >> "$FAKE_LOG"
    if [ -n "$FAKE_UNLOCK_EMPTY" ]; then
      printf ""
    else
      printf "%s" "session-token-123"
    fi
    ;;
  lock) printf "%s\n" "-- lock --" >> "$FAKE_LOG" ;;
  generate) printf "%s" "gen-pass-123" ;;
  sync) printf "%s\n" "-- sync --" >> "$FAKE_LOG" ;;
  serve)
    printf "%s\n" "-- serve --" >> "$FAKE_LOG"
    if [ -n "$FAKE_SERVE" ]; then
      exec "$FAKE_BUN_BIN" "$FAKE_DAEMON_FIXTURE" "$3"
    fi
    exit 1
    ;;
  list)
    printf "%s\n" "-- list items --" >> "$FAKE_LOG"
    if [ -n "$FAKE_GET_MISSING" ]; then echo "not found" >&2; exit 1; fi
    if [ -n "$FAKE_EMPTY_VAULT" ]; then printf '%s' '[]'; exit 0; fi
    printf '%s' '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass","totp":"otpauth://totp/example"},"fields":[{"name":"source","value":"https://example.com","type":0}]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"base/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/extra","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]'
    ;;
  get)
    if [ "$2" = "totp" ]; then printf "%s" "123456"; exit 0; fi
    printf "%s\n" "-- get $3 --" >> "$FAKE_LOG"
    if [ -n "$FAKE_GET_MISSING" ]; then echo "not found" >&2; exit 1; fi
    if printf '%s' "$3" | rg -q "missing"; then echo "not found" >&2; exit 1; fi
    printf '{"id":"item-1","name":"%s","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}' "$3"
    ;;
  create)
    printf "%s\n" "-- create --" >> "$FAKE_LOG"
    if [ -n "$FAKE_CREATE_FAIL" ]; then echo "fake create exploded" >&2; exit 1; fi
    base64 -d >> "$FAKE_LOG" 2>/dev/null
    ;;
  edit) printf "%s\n" "-- edit --" >> "$FAKE_LOG"; base64 -d >> "$FAKE_LOG" ;;
  delete) printf "%s\n" "-- delete $3 --" >> "$FAKE_LOG" ;;
esac
EOF
chmod +x "$tmp/bin/bw"

cat > "$tmp/bin/pbcopy" <<'EOF'
#!/bin/sh
cat > "$FAKE_CLIP"
EOF
chmod +x "$tmp/bin/pbcopy"

cat > "$tmp/bin/open" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" > "$FAKE_OPEN"
EOF
chmod +x "$tmp/bin/open"

cat > "$tmp/bin/security" <<'EOF'
#!/bin/sh
case "$1" in
  add-generic-password) printf '%s' "${@: -1}" > "$FAKE_KEYCHAIN" ;;
  find-generic-password) cat "$FAKE_KEYCHAIN" 2>/dev/null || exit 44 ;;
  delete-generic-password) rm -f "$FAKE_KEYCHAIN" ;;
esac
EOF
chmod +x "$tmp/bin/security"

cat > "$tmp/bin/secret-unlock-helper" <<'EOF'
#!/bin/sh
printf "%s" "session-token-123"
EOF
chmod +x "$tmp/bin/secret-unlock-helper"

cat > "$tmp/proj/.secret.json" <<'EOF'
{
  "secrets": {
    "DATABASE_URL": { "item": "myapp/database-url", "field": "password" },
    "github-token": { "item": "nixfiles/github-token", "field": "password", "env": "GITHUB_TOKEN" }
  },
  "environments": {
    "dev": {
      "secrets": {
        "DATABASE_URL": { "item": "myapp/database-url-dev", "field": "password" }
      }
    }
  }
}
EOF

export PATH="$tmp/bin:$PATH"
export HOME="$tmp"
export FAKE_LOG="$tmp/log.txt"
export FAKE_CLIP="$tmp/clip.txt"
export FAKE_OPEN="$tmp/open.txt"
export FAKE_KEYCHAIN="$tmp/keychain.txt"
export FAKE_BW_STATUS='{"status":"unlocked"}'
export SECRET_DAEMON=0

pass=0
fail=0
assert_eq() {
  if [ "$1" = "$2" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $3" >&2
    echo "  expected: $2" >&2
    echo "  got:      $1" >&2
  fi
}
assert_ok() {
  if "$@" >/dev/null 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $*" >&2
  fi
}
assert_fail() {
  if "$@" >/dev/null 2>&1; then
    fail=$((fail + 1))
    echo "FAIL: expected failure: $*" >&2
  else
    pass=$((pass + 1))
  fi
}

if [ "$impl" = "swift" ]; then
  secret() { "$swift_bin" "$@"; }
else
  secret() { "$bun_bin" "$script" "$@"; }
fi

cd "$tmp/proj"

assert_eq "$(secret status)" "unlocked — ready. next: secret list, or secret env --output .env" "status unlocked"
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status)" "locked — unlock with: secret unlock --store" "status locked"
assert_eq "$(FAKE_BW_STATUS='{"status":"unauthenticated"}' secret status)" "unauthenticated — run: bw login, then secret unlock --store" "status unauthenticated"
assert_eq "$(secret -h | tr '\n' ' ' | rg -o 'status\|unlock\|lock\|list\|search\|get\|set\|edit\|id\|totp\|source\|pull\|pin\|rotate\|rm\|unset\|mv\|init\|env\|run\|print\|global\|prune\|lint\|doctor\|recent\|history')" "status|unlock|lock|list|search|get|set|edit|id|totp|source|pull|pin|rotate|rm|unset|mv|init|env|run|print|global|prune|lint|doctor|recent|history" "help lists all commands"
if secret -h | rg -q 'set \(s, add\)' && secret -h | rg -q 'rm \(delete, remove\)' && secret -h | rg -q 'source \(so\)' && secret -h | rg -q 'pull \(pu, sync\)' && secret -h | rg -q 'env \(e\)'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: help shows the curated aliases" >&2
fi
assert_eq "$(secret env -h 2>&1 | head -1)" "Usage: secret env [--output FILE] [--env NAME] [--export] [--diff|--dry|--dry-run] [--required a,b,c] [--optional a,b,c]" "-h after a command shows that command's help"
assert_eq "$(secret help env 2>&1 | head -1)" "Usage: secret env [--output FILE] [--env NAME] [--export] [--diff|--dry|--dry-run] [--required a,b,c] [--optional a,b,c]" "secret help env shows env help"
assert_eq "$(secret --help 2>&1 | head -1)" "Usage: secret <status|unlock|lock|list|search|get|set|edit|id|totp|source|pull|pin|rotate|rm|unset|mv|init|env|run|print|global|prune|lint|doctor|recent|history> [options]" "--help is accepted"
assert_eq "$(secret get github-token)" "old-pass" "get value"
assert_eq "$(secret source github-token)" "https://example.com" "source prints the stored URL"
rm -f "$FAKE_OPEN"
secret source github-token --open >/dev/null 2>&1
assert_eq "$(cat "$FAKE_OPEN" 2>/dev/null || true)" "https://example.com" "source --open opens the stored URL"
rm -f "$FAKE_OPEN"
secret source github-token https://keys.example.com/rotated --open >/dev/null 2>&1
assert_eq "$(cat "$FAKE_OPEN" 2>/dev/null || true)" "https://keys.example.com/rotated" "source --open with a new url sets and opens it"
rg -q 'https://keys.example.com/rotated' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: source --open with a new url sends the edit payload" >&2
}
printf 'v12\n' | secret set github-token --force --source https://keys.example.com/new >/dev/null 2>&1
rg -q 'https://keys.example.com/new' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: set --source stores the URL in the edited item" >&2
}
printf 'v13\n' | secret edit github-token --field password --value-stdin --force >/dev/null 2>&1
rg -q 'v13' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: edit --value-stdin updates only the configured value field" >&2
}
secret edit github-token --source https://keys.example.com/edit --name 'GitHub token' --notes 'rotated by test' --force >/dev/null 2>&1
if rg -q 'https://keys.example.com/edit' "$FAKE_LOG" && rg -q 'rotated by test' "$FAKE_LOG" && rg -q 'GitHub token' "$FAKE_LOG"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: edit updates source, name, and notes without replacing the value" >&2
fi
secret edit github-token --tags "infra,production" --force >/dev/null 2>&1
if rg -q '"tags"' .secret.json && rg -q 'infra' .secret.json && rg -q 'production' .secret.json; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: edit --tags updates local alias labels" >&2
fi
secret edit github-token --tags "" --force >/dev/null 2>&1
if ! rg -q '"tags"' .secret.json; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: edit --tags empty clears local alias labels" >&2
fi
assert_eq "$(FAKE_EMPTY_VAULT=1 secret get github-token 2>&1 || true)" "secret: hint: the vault is empty — create items with 'secret set <alias>', or check the account/server in bw config
secret: item not found for github-token: nixfiles/github-token" "empty vault hints before item not found"
: > "$FAKE_LOG"
secret get github-token >/dev/null
assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "get uses a single bw spawn (batched list)"
assert_eq "$(rg -c -- '-- get ' "$FAKE_LOG" || echo 0)" "0" "get never spawns bw get"
assert_eq "$(secret g github-token)" "old-pass" "alias g maps to get"
assert_eq "$(printf "x" | secret add github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "add aliases set"

rm -f "$FAKE_CLIP"
secret get github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "old-pass" "get --copy"

assert_eq "$(printf "x" | secret set github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "set blocked without force"
assert_ok bash -c 'printf "v2" | "$0" $1 set github-token --force' "$secret_bin0" "$secret_bin1"
assert_ok env FAKE_GET_MISSING=1 bash -c 'printf "v3" | "$0" $1 set github-token' "$secret_bin0" "$secret_bin1"
rg -q '"name":"nixfiles/github-token"' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: create sends base64 item JSON (name missing from decoded log)" >&2
}
assert_eq "$(FAKE_GET_MISSING=1 FAKE_CREATE_FAIL=1 bash -c 'printf "v4" | "$0" $1 set github-token' "$secret_bin0" "$secret_bin1" 2>&1 || true)" "secret: Bitwarden CLI request failed: fake create exploded" "create failures surface bw stderr"
mkdir -p "$tmp/setnew"
printf '%s' '{"secrets":{"EXISTING":{"item":"setnew/existing"}}}' > "$tmp/setnew/.secret.json"
cd "$tmp/setnew"
: > "$FAKE_LOG"
printf 's3cret\n' | secret set fresh-alias >/dev/null 2>&1
rg -q '"fresh-alias"' .secret.json && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: set adds a new alias to the config" >&2
}
printf 's4cret\n' | secret set fresh-metadata --source https://keys.example.com/fresh --name 'Fresh metadata' --notes 'fresh note' >/dev/null 2>&1
if rg -q 'https://keys.example.com/fresh' "$FAKE_LOG" && rg -q 'Fresh metadata' "$FAKE_LOG" && rg -q 'fresh note' "$FAKE_LOG"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: set creates source, name, and notes metadata" >&2
fi
rg -q '"name":"setnew/fresh-alias"' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: set creates the vault item for a new alias" >&2
}
mkdir -p "$tmp/typed"
printf '%s' '{"secrets":{}}' > "$tmp/typed/.secret.json"
FAKE_GET_MISSING=1 bash -c 'printf "ssh-private-key-content\n" | "$0" $1 set ssh-private-key --config "$2" --type secure-note --field notes --tags infra,ssh --expires-at 2030-01-01' "$secret_bin0" "$secret_bin1" "$tmp/typed/.secret.json" >/dev/null 2>&1
if rg -q '"type": "secure-note"' "$tmp/typed/.secret.json" && rg -q '"expiresAt": "2030-01-01"' "$tmp/typed/.secret.json" && rg -q '"tags": \[' "$tmp/typed/.secret.json" && rg -q '"type":2' "$FAKE_LOG"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: secure-note creation stores type, expiry, tags, and Bitwarden type 2" >&2
fi
mkdir -p "$tmp/envtyped"
printf '%s' '{"secrets":{}}' > "$tmp/envtyped/.secret.json"
FAKE_GET_MISSING=1 bash -c 'printf "staging-value\n" | "$0" $1 set staging-only --config "$2" --env staging' "$secret_bin0" "$secret_bin1" "$tmp/envtyped/.secret.json" >/dev/null 2>&1
rg -q '"environments"' "$tmp/envtyped/.secret.json" && rg -q '"staging-only"' "$tmp/envtyped/.secret.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: non-production set writes the alias under the selected environment" >&2
}
cd "$tmp/proj"
rm -f "$FAKE_CLIP"
assert_ok secret set github-token --generate --force
assert_eq "$(cat "$FAKE_CLIP")" "gen-pass-123" "set --generate delivers value to clipboard"
assert_eq "$(secret id github-token)" "item-1" "id resolves item id"
assert_fail secret get nope
assert_eq "$(secret totp github-token)" "123456" "totp code"
rm -f "$FAKE_CLIP"
secret totp github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "123456" "totp --copy"
assert_ok secret pull
assert_ok secret pu
assert_ok secret sync

FAKE_BW_STATUS='{"status":"unlocked"}' secret status --check >/dev/null 2>&1 && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: status --check exits 0 when unlocked" >&2
}
FAKE_BW_STATUS='{"status":"locked"}' secret status --check >/dev/null 2>&1 && {
  fail=$((fail + 1))
  echo "FAIL: status --check exits nonzero when locked" >&2
} || pass=$((pass + 1))

assert_eq "$(secret list --env dev | rg -c "database-url-dev")" "1" "list picks dev item"
assert_eq "$(secret env --env staging --output x 2>&1 || true)" "secret: unknown environment: staging (available: prod, dev)" "unknown env rejected"
assert_ok secret env --env dev --output .env.dev
assert_eq "$(secret env --required DATABASE_URL,STRIPE_KEY --output x 2>&1 || true)" "secret: required alias(es) not in project config: STRIPE_KEY (add them to .secret.json)" "env --required fails on missing alias"
assert_ok secret env --required DATABASE_URL --output .env
: > "$FAKE_LOG"
assert_ok secret env --output .env
assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "env batches all aliases into one bw list"
assert_eq "$(rg -c -- '-- get ' "$FAKE_LOG" || echo 0)" "0" "env never calls bw get per alias"

: > "$FAKE_LOG"
assert_ok secret pin DATABASE_URL
assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "pin resolves item ids from one bw list"
rg -q '"item": "item-1"' "$tmp/proj/.secret.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: pin rewrites item names to ids" >&2
}
assert_fail secret pin nope

assert_eq "$(secret rotate github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "rotate blocked without force"
assert_ok secret rotate github-token --force
rg -q -- "-- edit --" "$FAKE_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: rotate edits the vault item" >&2
}
assert_eq "$(cat "$FAKE_CLIP")" "gen-pass-123" "rotate delivers new value to clipboard"
assert_eq "$(secret rm github-token 2>&1 || true)" "secret: refusing to delete nixfiles/github-token without confirmation; pass --force" "rm blocked without force"
assert_eq "$(secret delete github-token 2>&1 || true)" "secret: refusing to delete nixfiles/github-token without confirmation; pass --force" "delete aliases rm"
assert_eq "$(secret remove github-token 2>&1 || true)" "secret: refusing to delete nixfiles/github-token without confirmation; pass --force" "remove aliases rm"
assert_ok secret rm github-token --force
rg -q -- "-- delete nixfiles/github-token --" "$FAKE_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: rm deletes the vault item" >&2
}
assert_eq "$(FAKE_GET_MISSING=1 secret rm github-token --force 2>&1 || true)" "secret: item not found for github-token: nixfiles/github-token" "rm missing item"
mkdir -p "$tmp/rmempty"
printf '%s' '{"secrets":{"GH":{"item":"rm/gh"}}}' > "$tmp/rmempty/.secret.json"
cd "$tmp/rmempty"
assert_eq "$(FAKE_EMPTY_VAULT=1 secret rm GH --force 2>&1 || true)" "secret: item not found in vault — removed GH from config" "rm falls back to unset when the item is confirmed missing"
rg -q '"GH"' .secret.json && {
  fail=$((fail + 1))
  echo "FAIL: rm-unset left the alias in the config" >&2
} || pass=$((pass + 1))
cd "$tmp/proj"
assert_fail secret rotate nope

assert_ok secret doctor
remote_json="$(secret doctor --json --config "$tmp/proj/.secret.json" 2>/dev/null || true)"
if printf '%s' "$remote_json" | rg -q '"alias":"github-token".*"status":"ok".*"itemName":"nixfiles/github-token".*"source":"https://example.com".*"hasTOTP":"true"' \
  && ! printf '%s' "$remote_json" | rg -q 'old-pass|otpauth://'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: doctor --json exposes value-free remote metadata and TOTP state" >&2
fi
printf '%s' '{"secrets":{"missing":{"item":"not/in-vault"}}}' > "$tmp/missing-remote.json"
missing_json="$(secret doctor --json --config "$tmp/missing-remote.json" 2>/dev/null || true)"
if printf '%s' "$missing_json" | rg -q '"alias":"missing".*"status":"missing"'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: doctor --json reports missing remote items" >&2
fi
assert_eq "$(secret doctor | rg -o 'daemon\tdisabled' || true)" "daemon	disabled" "doctor reports daemon state"
assert_fail FAKE_GET_MISSING=1 secret doctor
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret doctor 2>&1 | head -1)" "bitwarden: locked — unlock with: secret unlock --store" "doctor locked hint"

assert_ok secret lint
printf '%s' '{"secrets":{"A":{"item":"x/a"},"B":{"item":"x/b","env":"A"}}}' > "$tmp/collide.json"
assert_fail secret lint --config "$tmp/collide.json"
assert_eq "$(secret lint --config "$tmp/collide.json" 2>&1 | head -1)" "project	B	dotenv key A collides with project:A (last wins silently)" "lint flags env-key collision"
printf '%s' '{"secrets":{"BAD-NAME":{"item":"x/bad"}}}' > "$tmp/badkey.json"
assert_fail secret lint --config "$tmp/badkey.json"
assert_eq "$(secret lint --config "$tmp/badkey.json" 2>&1 | head -1)" 'project	BAD-NAME	invalid dotenv key (add an explicit "env" field)' "lint flags invalid dotenv key"
printf '%s' '{"secrets":{"X":{}}}' > "$tmp/missing.json"
assert_fail secret lint --config "$tmp/missing.json"
assert_eq "$(secret lint --config "$tmp/missing.json" --json)" '[{"scope":"project","alias":"X","message":"invalid definition (missing item)"}]' "lint --json rows"

assert_eq "$(secret print)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN')" "print project scope after pin"
assert_eq "$(secret pr)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN')" "alias pr maps to print"
assert_eq "$(secret print global 2>&1 || true)" "secret: no config file for global scope: $tmp/.config/secret/config.json" "print global missing config explains"
assert_eq "$(secret global 2>&1 || true)" "secret: no config file for global scope: $tmp/.config/secret/config.json" "global shows the user scope"
printf 'gv\n' | secret set --global global-alias >/dev/null 2>&1
rg -q '"global-alias"' "$tmp/.config/secret/config.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: set --global writes the user config" >&2
}
assert_eq "$(secret global | head -1 | cut -f1)" "global-alias" "global lists the new alias"
secret unset --global global-alias >/dev/null 2>&1
printf 'gv\n' | secret global add ga2 >/dev/null 2>&1
rg -q '"ga2"' "$tmp/.config/secret/config.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: secret global add writes the user config" >&2
}
secret global unset ga2 >/dev/null 2>&1
rg -q '"ga2"' "$tmp/.config/secret/config.json" && {
  fail=$((fail + 1))
  echo "FAIL: secret global unset removes the alias" >&2
} || pass=$((pass + 1))
mkdir -p "$tmp/scope-project"
printf '%s' '{"secrets":{}}' > "$tmp/scope-project/.secret.json"
scope_config="$tmp/scope-project/.secret.json"
printf 'scope-value\n' | secret set --config "$scope_config" shared-alias >/dev/null 2>&1
if rg -q '"shared-alias"' "$scope_config" && rg -q '"name":"scope-project/shared-alias"' "$FAKE_LOG"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: set scopes a colliding alias to the selected repo config" >&2
fi
mkdir -p "$tmp/prunedir"
printf '%s' '{"secrets":{"KEEP":{"item":"nixfiles/github-token"},"GONE":{"item":"nope/missing"}}}' > "$tmp/prunedir/.secret.json"
cd "$tmp/prunedir"
assert_ok secret prune --dry-run
rg -q '"GONE"' .secret.json && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: prune --dry-run leaves the config untouched" >&2
}
assert_ok secret prune
rg -q '"GONE"' .secret.json && {
  fail=$((fail + 1))
  echo "FAIL: prune removes the missing alias" >&2
} || pass=$((pass + 1))
rg -q '"KEEP"' .secret.json && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: prune keeps aliases present in the vault" >&2
}
cd "$tmp/proj"
assert_eq "$(secret print bogus 2>&1 || true)" "secret: unknown scope: bogus (available: project, global, local)" "print rejects unknown scope"
assert_eq "$(secret print --all)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tproject\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN')" "print --all merges scopes"
assert_eq "$(secret search database)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL')" "search matches alias and env key"
assert_eq "$(secret search github --json)" "[{\"alias\":\"github-token\",\"scope\":\"project\",\"env\":\"prod\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "search --json rows"
assert_eq "$(secret search nope 2>&1 || true)" "secret search: no matches for 'nope'. next: try another term, or 'secret print --all'" "search no match exits nonzero"
assert_eq "$(secret print --json)" "[{\"alias\":\"DATABASE_URL\",\"env\":\"dev\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"DATABASE_URL\",\"env\":\"prod\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"github-token\",\"env\":\"prod\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "print --json rows after pin"
assert_eq "$(secret list --json)" "[{\"alias\":\"DATABASE_URL\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\",\"createdAt\":\"2026-01-15T10:00:00.000Z\",\"source\":\"\",\"hasTOTP\":\"false\"},{\"alias\":\"github-token\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\",\"createdAt\":\"2026-01-15T10:00:00.000Z\",\"source\":\"https://example.com\",\"hasTOTP\":\"true\"}]" "list --json merged aliases after pin"
if command -v script >/dev/null 2>&1; then
  : > "$FAKE_LOG"
  script -q "$tmp/list-tty.txt" "$secret_bin0" $secret_bin1 list >/dev/null 2>&1 || true
  {
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'ALIAS' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'CREATED AT' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'SOURCE' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'https://example.com' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q '2026-01-15 [0-9]{2}:[0-9]{2}'
  } && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: list prints a table with created dates on a TTY" >&2
  }
  assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "list fetches vault items once"
else
  pass=$((pass + 1))
fi
assert_eq "$(secret env --export)" "$(printf 'export DATABASE_URL='\''old-pass'\''\n# source: https://example.com\nexport GITHUB_TOKEN='\''old-pass'\''')" "env --export shell lines with source comments"
printf "DATABASE_URL='stale'\n" > .env
assert_eq "$(secret env --diff --output .env)" "- DATABASE_URL='stale'
+ DATABASE_URL='old-pass'
+ # source: https://example.com
+ GITHUB_TOKEN='old-pass'" "env --diff shows changes without writing"
assert_eq "$(secret env --dry --output .env)" "$(secret env --diff --output .env)" "env --dry aliases --diff"
assert_eq "$(secret env --dry-run --output .env)" "$(secret env --diff --output .env)" "env --dry-run aliases --diff"
assert_eq "$(cat .env)" "DATABASE_URL='stale'" "env --diff leaves file untouched"
cd "$tmp/proj/sub"
assert_ok secret env --output .env
cd "$tmp/proj"

assert_ok secret mv DATABASE_URL DB_URL
assert_eq "$(secret print | head -1)" "DB_URL	dev	item-1	password	DB_URL" "mv renames base and env overrides"
assert_ok secret mv DB_URL DATABASE_URL
assert_eq "$(secret mv DATABASE_URL 9BAD 2>&1 || true)" "secret: invalid alias name: 9BAD (letters, digits, underscore, hyphen; must not start with a digit)" "mv rejects invalid alias name"
assert_eq "$(secret mv nope GH 2>&1 || true)" "secret: alias nope is not in a project, local, or user config (see 'secret print --all')" "mv refuses alias not in config"
assert_ok secret unset DATABASE_URL
assert_fail secret get DATABASE_URL
assert_eq "$(secret unset DATABASE_URL 2>&1 || true)" "secret: alias DATABASE_URL is not in a project, local, or user config (see 'secret print --all')" "unset second time reports not in config"
assert_eq "$(secret unset nope 2>&1 || true)" "secret: alias nope is not in a project, local, or user config (see 'secret print --all')" "unset refuses alias not in config"

secret get github-token >/dev/null
secret history | rg -q "get.*github-token" || {
  fail=$((fail + 1))
  echo "FAIL: history records get" >&2
}
secret recent | rg -q "github-token" || {
  fail=$((fail + 1))
  echo "FAIL: recent lists used alias" >&2
}
secret history --json | rg -q '"cmd":"get"' || {
  fail=$((fail + 1))
  echo "FAIL: history --json rows" >&2
}
secret recent --json | rg -q '"alias":"github-token"' || {
  fail=$((fail + 1))
  echo "FAIL: recent --json rows" >&2
}

mkdir -p "$tmp/initdir"
cd "$tmp/initdir"
assert_ok secret init
rg -q '"item": "initdir/example"' .secret.json && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: init scaffolds with directory prefix" >&2
}
assert_eq "$(secret init 2>&1 || true)" "secret: .secret.json already exists (use --force to overwrite): $(cd "$tmp/initdir" && pwd -P)/.secret.json" "init refuses overwrite without --force"
assert_ok secret init --force
assert_eq "$(secret print)" "EXAMPLE	prod	initdir/example	password	EXAMPLE" "print after init"
assert_ok secret init --force API_TOKEN STRIPE_KEY
rg -q 'API_TOKEN' .secret.json && rg -q 'STRIPE_KEY' .secret.json && rg -q 'initdir/api-token' .secret.json && rg -q 'initdir/stripe-key' .secret.json || {
  fail=$((fail + 1))
  echo "FAIL: init prefills first alias" >&2
}
assert_eq "$(secret init --force 9BAD 2>&1 || true)" "secret: invalid alias name: 9BAD (letters, digits, underscore, hyphen; must not start with a digit)" "init rejects invalid alias"
assert_eq "$(secret mv API_TOKEN STRIPE_KEY 2>&1 || true)" "secret: alias STRIPE_KEY already exists in $(cd "$tmp/initdir" && pwd -P)/.secret.json" "mv refuses rename onto existing alias"
cd "$tmp"
assert_eq "$(secret print 2>&1 || true)" "secret: no .secret.json found (searched up to \$HOME) — run 'secret init' to scaffold one, or pass --config FILE" "print outside project suggests init"

mkdir -p "$tmp/localdir"
printf '%s' '{"secrets":{"BASE":{"item":"base/item"}}}' > "$tmp/localdir/.secret.json"
printf '%s' '{"secrets":{"BASE":{"item":"local/item"},"EXTRA":{"item":"local/extra"}}}' > "$tmp/localdir/.secret.local.json"
cd "$tmp/localdir"
assert_eq "$(secret list)" "$(printf 'BASE\tlocal/item\tpassword\nEXTRA\tlocal/extra\tpassword')" "local overrides project item and adds alias"
assert_eq "$(secret env --export)" "$(printf 'export BASE='\''old-pass'\''\nexport EXTRA='\''old-pass'\''')" "env includes local aliases"
assert_eq "$(secret print local | head -1)" "BASE	prod	local/item	password	BASE" "print local scope"
assert_ok secret lint
assert_ok secret pin EXTRA
rg -q '"item": "item-1"' .secret.local.json && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: pin edits the local config" >&2
}
assert_ok secret unset EXTRA
rg -q '"EXTRA"' .secret.local.json && {
  fail=$((fail + 1))
  echo "FAIL: unset removes from the local config" >&2
} || pass=$((pass + 1))
assert_eq "$(secret get BASE)" "old-pass" "local item wins"
assert_eq "$(secret run -- sh -c 'echo $BASE')" "[scrubbed]" "run injects env and scrubs secret values from output"
secret run -- sh -c 'exit 3' 2>/dev/null && {
  fail=$((fail + 1))
  echo "FAIL: run propagates nonzero exit" >&2
} || {
  code=$?
  [ "$code" -eq 3 ] && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: run exit code was $code, expected 3" >&2
  }
}
assert_fail secret run
cd "$tmp"

mkdir -p "$tmp/optdir"
printf '%s' '{"secrets":{"BASE":{"item":"base/item"},"BROKEN":{"item":"base/missing"}}}' > "$tmp/optdir/.secret.json"
cd "$tmp/optdir"
assert_fail secret run -- sh -c 'echo hi'
assert_eq "$(secret run --optional BROKEN -- sh -c 'echo $BASE')" "[scrubbed]" "run --optional skips unresolved aliases (output scrubbed)"
assert_eq "$(secret env --optional BROKEN --export)" "$(printf 'export BASE='\''old-pass'\''')" "env --optional skips unresolved aliases"
cd "$tmp"

mkdir -p "$tmp/envmiss"
printf '%s' '{"secrets":{"A":{"item":"x/a"},"B":{"item":"x/b"}}}' > "$tmp/envmiss/.secret.json"
cd "$tmp/envmiss"
assert_eq "$(secret env 2>&1 || true)" "secret: hint: pass --optional A,B to skip unresolved aliases
secret: item not found for A: x/a" "env lists all missing aliases in the optional hint"
cd "$tmp"

# ---- daemon mode: bw serve over a unix socket ----
cd "$tmp/proj"
export SECRET_DAEMON=1 FAKE_SERVE=1 FAKE_DAEMON_FIXTURE="$root/assets/bitwarden/test-daemon.ts"
printf '%s' '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[{"name":"source","value":"https://example.com","type":0}]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]' > "$tmp/daemon-items.json"
export FAKE_DAEMON_ITEMS="$tmp/daemon-items.json"
export FAKE_DAEMON_LOG="$tmp/daemon-log.txt"
export FAKE_DAEMON_MISSING="$tmp/daemon-missing.txt"
: > "$FAKE_DAEMON_LOG"
: > "$FAKE_LOG"
assert_eq "$(secret status)" "unlocked — ready. next: secret list, or secret env --output .env (daemon up)" "daemon status reports the daemon"
assert_eq "$(secret get github-token)" "old-pass" "daemon get via HTTP"
assert_eq "$(secret env --export)" "$(printf '# source: https://example.com\nexport GITHUB_TOKEN='\''old-pass'\''')" "daemon env via HTTP"
assert_eq "$(secret run -- sh -c 'echo $GITHUB_TOKEN')" "[scrubbed]" "daemon run via HTTP (output scrubbed)"
assert_eq "$(rg -c -- '-- serve --' "$FAKE_LOG" || echo 0)" "1" "daemon spawned exactly once"
assert_eq "$(rg -c -- '-- get ' "$FAKE_LOG" || echo 0)" "0" "daemon mode never spawns bw get"
assert_eq "$(rg -c 'GET /list/object/items' "$FAKE_DAEMON_LOG" || echo 0)" "3" "three item lists served over HTTP"
touch "$FAKE_DAEMON_MISSING"
assert_fail secret env --output x
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status)" "locked — unlock with: secret unlock --store" "locked daemon falls back to spawn status"
rm -f "$FAKE_DAEMON_MISSING"
assert_eq "$(secret run -- sh -c 'echo $GITHUB_TOKEN')" "[scrubbed]" "daemon recovers after denied requests (output scrubbed)"
# mutations ride the daemon while it is up
: > "$FAKE_LOG"
: > "$FAKE_DAEMON_LOG"
assert_ok secret pull
rg -q "POST /sync" "$FAKE_DAEMON_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: pull uses the daemon sync" >&2
}
assert_eq "$(rg -c -- '-- sync --' "$FAKE_LOG" || echo 0)" "0" "pull does not spawn bw sync"
printf 'v9\n' | secret set github-token --force >/dev/null 2>&1
rg -q "PUT /object/item/item-1" "$FAKE_DAEMON_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: set edits via the daemon" >&2
}
assert_eq "$(rg -c -- '-- edit --' "$FAKE_LOG" || echo 0)" "0" "set does not spawn bw edit"
assert_ok secret rotate github-token --force
rg -q "GET /generate" "$FAKE_DAEMON_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: rotate generates via the daemon" >&2
}
assert_ok secret rm github-token --force
rg -q "DELETE /object/item/item-1" "$FAKE_DAEMON_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: rm deletes via the daemon" >&2
}
assert_eq "$(rg -c -- '-- delete ' "$FAKE_LOG" || echo 0)" "0" "rm does not spawn bw delete"
mkdir -p "$tmp/daemon-set"
printf '%s' '{"secrets":{"new-alias":{"item":"new/item"}}}' > "$tmp/daemon-set/.secret.json"
cd "$tmp/daemon-set"
printf 'v10\n' | secret set new-alias >/dev/null 2>&1
rg -q "POST /object/item" "$FAKE_DAEMON_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: set creates via the daemon" >&2
}
cd "$tmp/proj"
: > "$FAKE_LOG"
assert_ok secret lock
assert_eq "$(rg -c -- '-- lock --' "$FAKE_LOG" || echo 0)" "1" "lock still spawns bw lock"
test ! -e "$tmp/.config/secret/daemon/bw.sock" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: lock removes the daemon socket" >&2
}
test ! -e "$tmp/.config/secret/daemon/daemon.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: lock removes the daemon state" >&2
}
assert_eq "$(secret unlock --helper 2>/dev/null)" "" "Touch ID helper keeps its token out of stdout when the daemon starts"
assert_eq "$(secret status)" "unlocked — ready. next: secret list, or secret env --output .env (daemon up)" "Touch ID helper leaves a reusable unlocked daemon"
assert_eq "$(secret get github-token)" "old-pass" "Touch ID helper daemon serves the next read"
assert_ok secret lock
export SECRET_DAEMON=0 FAKE_SERVE=0
cd "$tmp"

assert_eq "$(secret unlock)" "session-token-123" "unlock prints raw session token"
assert_eq "$(secret unlock --helper)" "session-token-123" "unlock --helper uses the Touch ID session"
if command -v expect >/dev/null 2>&1; then
  cat > "$tmp/reunlock.exp" <<EXP
set timeout 30
log_file -a $tmp/reunlock.txt
spawn env FAKE_BW_STATUS={"status":"locked"} PATH=$tmp/bin:$PATH HOME=$tmp SECRET_DAEMON=0 $secret_bin0 $secret_bin1 rotate github-token --force
send "mp\r"
expect "rotated"
EXP
  : > "$FAKE_KEYCHAIN"
  cd "$tmp/proj"
  expect "$tmp/reunlock.exp" >/dev/null 2>&1
  cd "$tmp"
  case "$(sed 's/\x1b\[[0-9;]*m//g' "$tmp/reunlock.txt")" in
    *"Bitwarden is locked"*)
      fail=$((fail + 1)); echo "FAIL: graceful re-unlock left the vault locked" >&2 ;;
    *"rotated"*)
      pass=$((pass + 1)) ;;
    *)
      fail=$((fail + 1)); echo "FAIL: graceful re-unlock did not rotate" >&2 ;;
  esac
else
  echo "skipping graceful re-unlock tests (expect not on PATH)" >&2
fi
: > "$FAKE_LOG"
assert_eq "$(BW_SESSION=stale-token secret unlock)" "session-token-123" "unlock ignores stale env and obtains a fresh session"
assert_eq "$(rg -c -- 'unlock-env:' "$FAKE_LOG" || echo 0)" "1" "unlock always prompts for a fresh session"
: > "$FAKE_KEYCHAIN"
# unlock ignores any inherited BW_SESSION: it always means "fresh session"
BW_SESSION=stale-dead-token secret unlock --store >/dev/null 2>&1
assert_eq "$(cat "$FAKE_KEYCHAIN" 2>/dev/null || true)" "session-token-123" "unlock --store persists a fresh session, ignoring stale env"
reject_out="$(FAKE_BW_STATUS='{"status":"locked"}' FAKE_BW_REJECT_UNLOCK=1 secret unlock --store 2>&1 || true)"
case "$reject_out" in
  *"bw status did not confirm the new session"*"unlocked; session stored"*)
    pass=$((pass + 1)) ;;
  *)
    fail=$((fail + 1)); echo "FAIL: rejected fresh session should warn-and-store: $reject_out" >&2 ;;
esac
assert_eq "$(FAKE_UNLOCK_EMPTY=1 secret unlock --store 2>&1 || true)" "secret: bw unlock returned no session token" "unlock refuses to store an empty token"
if FAKE_BW_REJECT_UNLOCK=1 FAKE_BW_STATUS='{"status":"locked"}' secret unlock --store 2>&1 >/dev/null | rg -q "did not confirm the new session"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: unlock warns when bw rejects the fresh session" >&2
fi
assert_eq "$(secret unlock --store 2>/dev/null)" "" "unlock --store keeps token off stdout"
if BW_SESSION=x FAKE_BW_STATUS='{"status":"locked"}' secret status 2>&1 >/dev/null | rg -q "session token is present but bw rejects it"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: status hints when a present session is rejected" >&2
fi
if [ "$(uname -s)" = "Darwin" ]; then
  assert_eq "$(cat "$FAKE_KEYCHAIN")" "session-token-123" "unlock --store persists session in keychain"
else
  assert_eq "$(cat "$tmp/.config/secret/session")" "session-token-123" "unlock --store persists session file"
fi
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status 2>/dev/null)" "locked — unlock with: secret unlock --store" "status locked stdout unchanged with stored session"
FAKE_BW_STATUS='{"status":"locked"}' secret status 2>&1 >/dev/null | rg -q "stale" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: status hints at stale stored session" >&2
}
assert_ok secret lock
rg -q -- "-- lock --" "$FAKE_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: lock calls bw lock" >&2
}
if [ "$(uname -s)" = "Darwin" ]; then
  test ! -e "$FAKE_KEYCHAIN" && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: lock clears keychain session" >&2
  }
else
  test ! -e "$tmp/.config/secret/session" && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: lock clears stored session file" >&2
  }
fi


# --- backend selection / env --export / scrubbing / check -------------------
mkdir -p "$tmp/bd"
printf '%s' '{"secrets":{"DATABASE_URL":{"item":"myapp/database-url"}}}' > "$tmp/bd/.secret.json"
cd "$tmp/bd"

cat > "$tmp/.config/secret/config.json" <<EOF
{ "backend": "doesnotexist" }
EOF
assert_eq "$(secret status 2>&1 || true)" "secret: unknown vault backend 'doesnotexist' (available: bitwarden, keychain)" "unknown backend fails with available list"

printf '{}\n' > "$tmp/.config/secret/config.json"
export_lines="$(secret env --export 2>/dev/null)"
assert_eq "$(printf '%s' "$export_lines" | rg -c '^export DATABASE_URL=' || echo 0)" "1" "env --export emits export lines"
eval "$export_lines"
assert_eq "$DATABASE_URL" "old-pass" "env --export output evals to the secret value"

scrubbed="$(secret run -- sh -c 'echo "leak: $DATABASE_URL"' 2>/dev/null)"
case "$scrubbed" in
  *old-pass*)
    fail=$((fail + 1)); echo "FAIL: run leaks secret values into stdout" >&2 ;;
  *"leak: [scrubbed]"*)
    pass=$((pass + 1)) ;;
  *)
    fail=$((fail + 1)); echo "FAIL: run scrub unexpected output: $scrubbed" >&2 ;;
esac

check_out="$(secret check 2>&1)"; check_rc=$?
assert_eq "$check_rc" "0" "check exits 0 when all aliases resolve"
case "$check_out" in
  *"aliases ok"*) pass=$((pass + 1)) ;;
  *) fail=$((fail + 1)); echo "FAIL: check prints summary line" >&2 ;;
esac

printf '%s' '{"secrets":{"DATABASE_URL":{"item":"myapp/database-url","expiresAt":"2020-01-01"}}}' > .secret.json
secret check >/dev/null 2>&1 && { fail=$((fail + 1)); echo "FAIL: check should exit 1 on expired secret" >&2; } || pass=$((pass + 1))
check_expired="$(secret check 2>&1 || true)"
case "$check_expired" in
  *expired*DATABASE_URL*) pass=$((pass + 1)) ;;
  *) fail=$((fail + 1)); echo "FAIL: check flags expired secret: $check_expired" >&2 ;;
esac

# --- keychain backend roundtrip (swift only, opt-in) ------------------------
if [ "$impl" = "swift" ] && [ -n "${RUN_KEYCHAIN_TESTS:-}" ]; then
  export SECRET_KEYCHAIN_SERVICE="dev.astahmer.secret-tests-$$"
  printf '%s' '{ "backend": "keychain" }' > "$tmp/.config/secret/config.json"
  printf 'kc-pass-42\n' | secret set kc/test-item --force >/dev/null 2>&1 && pass=$((pass + 1)) || {
    fail=$((fail + 1)); echo "FAIL: keychain set" >&2
  }
  assert_eq "$(secret get kc/test-item 2>/dev/null)" "kc-pass-42" "keychain get roundtrip"
  printf 'kc-pass-43\n' | secret set kc/test-item --force >/dev/null 2>&1
  assert_eq "$(secret get kc/test-item 2>/dev/null)" "kc-pass-43" "keychain update roundtrip"
  secret rm kc/test-item --force >/dev/null 2>&1
  secret get kc/test-item >/dev/null 2>&1 && { fail=$((fail + 1)); echo "FAIL: keychain delete" >&2; } || pass=$((pass + 1))
  unset SECRET_KEYCHAIN_SERVICE
fi
cd "$tmp"

echo "secret tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
