#!/usr/bin/env bash
# Fake-bw regression suite for assets/bitwarden/secret.ts.
# Self-contained: builds a fake bw/pbcopy, a temp HOME, and asserts behavior
# without touching a real vault or the network.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/assets/bitwarden/secret.ts"
bun_bin="${BUN:-bun}"
export FAKE_BUN_BIN="$bun_bin"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/config/secret" "$tmp/proj/sub"

cat > "$tmp/bin/bw" <<'EOF'
#!/bin/sh
case "$1" in
  status) printf "%s" "$FAKE_BW_STATUS" ;;
  unlock)
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
    printf '%s' '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"base/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/extra","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]'
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

cat > "$tmp/bin/security" <<'EOF'
#!/bin/sh
case "$1" in
  add-generic-password) printf '%s' "${@: -1}" > "$FAKE_KEYCHAIN" ;;
  find-generic-password) cat "$FAKE_KEYCHAIN" 2>/dev/null || exit 44 ;;
  delete-generic-password) rm -f "$FAKE_KEYCHAIN" ;;
esac
EOF
chmod +x "$tmp/bin/security"

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

secret() { "$bun_bin" "$script" "$@"; }

cd "$tmp/proj"

assert_eq "$(secret status)" "unlocked — ready. next: secret list, or secret env --output .env" "status unlocked"
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status)" 'locked — unlock with: export BW_SESSION="$(bw unlock --raw)"' "status locked"
assert_eq "$(FAKE_BW_STATUS='{"status":"unauthenticated"}' secret status)" 'unauthenticated — run: bw login, then export BW_SESSION="$(bw unlock --raw)"' "status unauthenticated"
assert_eq "$(secret -h | tr '\n' ' ' | rg -o 'status\|unlock\|lock\|list\|search\|get\|set\|id\|totp\|pull\|pin\|rotate\|rm\|unset\|mv\|init\|env\|run\|print\|lint\|doctor\|recent\|history')" "status|unlock|lock|list|search|get|set|id|totp|pull|pin|rotate|rm|unset|mv|init|env|run|print|lint|doctor|recent|history" "help lists all commands"
assert_eq "$(secret env -h 2>&1 | head -1)" "Usage: secret <status|unlock|lock|list|search|get|set|id|totp|pull|pin|rotate|rm|unset|mv|init|env|run|print|lint|doctor|recent|history> [options]" "-h after a command shows global help"
assert_eq "$(secret --help 2>&1 | head -1)" "Usage: secret <status|unlock|lock|list|search|get|set|id|totp|pull|pin|rotate|rm|unset|mv|init|env|run|print|lint|doctor|recent|history> [options]" "--help is accepted"
assert_eq "$(secret get github-token)" "old-pass" "get value"
assert_eq "$(FAKE_EMPTY_VAULT=1 secret get github-token 2>&1 || true)" "secret: hint: the vault is empty — create items with 'secret set <alias>', or check the account/server in bw config
secret: item not found for github-token: nixfiles/github-token" "empty vault hints before item not found"
: > "$FAKE_LOG"
secret get github-token >/dev/null
assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "get uses a single bw spawn (batched list)"
assert_eq "$(rg -c -- '-- get ' "$FAKE_LOG" || echo 0)" "0" "get never spawns bw get"
assert_eq "$(secret g github-token)" "old-pass" "alias g maps to get"

rm -f "$FAKE_CLIP"
secret get github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "old-pass" "get --copy"

assert_eq "$(printf "x" | secret set github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "set blocked without force"
assert_ok bash -c 'printf "v2" | "$0" "$1" set github-token --force' "$bun_bin" "$script"
assert_ok env FAKE_GET_MISSING=1 bash -c 'printf "v3" | "$0" "$1" set github-token' "$bun_bin" "$script"
rg -q '"name":"nixfiles/github-token"' "$FAKE_LOG" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: create sends base64 item JSON (name missing from decoded log)" >&2
}
assert_eq "$(FAKE_GET_MISSING=1 FAKE_CREATE_FAIL=1 bash -c 'printf "v4" | "$0" "$1" set github-token' "$bun_bin" "$script" 2>&1 || true)" "secret: Bitwarden CLI request failed: fake create exploded" "create failures surface bw stderr"
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
assert_ok secret sy
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
assert_ok secret rm github-token --force
rg -q -- "-- delete nixfiles/github-token --" "$FAKE_LOG" || {
  fail=$((fail + 1))
  echo "FAIL: rm deletes the vault item" >&2
}
assert_eq "$(FAKE_GET_MISSING=1 secret rm github-token --force 2>&1 || true)" "secret: item not found for github-token: nixfiles/github-token" "rm missing item"
assert_fail secret rotate nope

assert_ok secret doctor
assert_fail FAKE_GET_MISSING=1 secret doctor
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret doctor 2>&1 | head -1)" 'bitwarden: locked — unlock with: export BW_SESSION="$(bw unlock --raw)"' "doctor locked hint"

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
assert_eq "$(secret print bogus 2>&1 || true)" "secret: unknown scope: bogus (available: project, global, local)" "print rejects unknown scope"
assert_eq "$(secret print --all)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tproject\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN')" "print --all merges scopes"
assert_eq "$(secret search database)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL')" "search matches alias and env key"
assert_eq "$(secret search github --json)" "[{\"alias\":\"github-token\",\"scope\":\"project\",\"env\":\"prod\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "search --json rows"
assert_eq "$(secret search nope 2>&1 || true)" "secret search: no matches for 'nope'. next: try another term, or 'secret print --all'" "search no match exits nonzero"
assert_eq "$(secret print --json)" "[{\"alias\":\"DATABASE_URL\",\"env\":\"dev\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"DATABASE_URL\",\"env\":\"prod\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"github-token\",\"env\":\"prod\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "print --json rows after pin"
assert_eq "$(secret list --json)" "[{\"alias\":\"DATABASE_URL\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"github-token\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "list --json merged aliases after pin"
if command -v script >/dev/null 2>&1; then
  : > "$FAKE_LOG"
  script -q "$tmp/list-tty.txt" "$bun_bin" "$script" list >/dev/null 2>&1 || true
  {
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'ALIAS' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'CREATED AT' &&
    tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q '2026-01-15 [0-9]{2}:[0-9]{2}'
  } && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: list prints a table with created dates on a TTY" >&2
  }
  assert_eq "$(rg -c -- '-- list items --' "$FAKE_LOG" || echo 0)" "1" "list fetches vault items once"
else
  pass=$((pass + 1))
fi
assert_eq "$(secret env --export)" "$(printf 'export DATABASE_URL='\''old-pass'\''\nexport GITHUB_TOKEN='\''old-pass'\''')" "env --export shell lines"
printf "DATABASE_URL='stale'\n" > .env
assert_eq "$(secret env --diff --output .env)" "- DATABASE_URL='stale'
+ DATABASE_URL='old-pass'
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
assert_eq "$(secret mv DATABASE_URL BAD-NAME 2>&1 || true)" "secret: invalid alias name: BAD-NAME (letters, digits, underscore; must not start with a digit)" "mv rejects invalid alias name"
assert_eq "$(secret mv nope GH 2>&1 || true)" "secret: alias nope is not in a project, local, or user config (see 'secret print --all')" "mv refuses alias not in config"
assert_ok secret u DATABASE_URL
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
assert_eq "$(secret init --force BAD-NAME 2>&1 || true)" "secret: invalid alias name: BAD-NAME (letters, digits, underscore; must not start with a digit)" "init rejects invalid alias"
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
assert_eq "$(secret run -- sh -c 'echo $BASE')" "old-pass" "run injects project env"
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
assert_eq "$(secret run --optional BROKEN -- sh -c 'echo $BASE')" "old-pass" "run --optional skips unresolved aliases"
assert_eq "$(secret env --optional BROKEN --export)" "$(printf 'export BASE='\''old-pass'\''')" "env --optional skips unresolved aliases"
cd "$tmp"

# ---- daemon mode: bw serve over a unix socket ----
cd "$tmp/proj"
export SECRET_DAEMON=1 FAKE_SERVE=1 FAKE_DAEMON_FIXTURE="$root/assets/bitwarden/test-daemon.ts"
printf '%s' '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]' > "$tmp/daemon-items.json"
export FAKE_DAEMON_ITEMS="$tmp/daemon-items.json"
export FAKE_DAEMON_LOG="$tmp/daemon-log.txt"
export FAKE_DAEMON_MISSING="$tmp/daemon-missing.txt"
: > "$FAKE_DAEMON_LOG"
: > "$FAKE_LOG"
assert_eq "$(secret status)" "unlocked — ready. next: secret list, or secret env --output .env" "daemon status output matches spawn mode"
assert_eq "$(secret get github-token)" "old-pass" "daemon get via HTTP"
assert_eq "$(secret env --export)" "$(printf 'export GITHUB_TOKEN='\''old-pass'\''')" "daemon env via HTTP"
assert_eq "$(secret run -- sh -c 'echo $GITHUB_TOKEN')" "old-pass" "daemon run via HTTP"
assert_eq "$(rg -c -- '-- serve --' "$FAKE_LOG" || echo 0)" "1" "daemon spawned exactly once"
assert_eq "$(rg -c -- '-- get ' "$FAKE_LOG" || echo 0)" "0" "daemon mode never spawns bw get"
assert_eq "$(rg -c 'GET /list/object/items' "$FAKE_DAEMON_LOG" || echo 0)" "3" "three item lists served over HTTP"
touch "$FAKE_DAEMON_MISSING"
assert_fail secret env --output x
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status)" 'locked — unlock with: export BW_SESSION="$(bw unlock --raw)"' "locked daemon falls back to spawn status"
rm -f "$FAKE_DAEMON_MISSING"
assert_eq "$(secret run -- sh -c 'echo $GITHUB_TOKEN')" "old-pass" "daemon recovers after denied requests"
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
export SECRET_DAEMON=0 FAKE_SERVE=0
cd "$tmp"

assert_eq "$(secret unlock)" "session-token-123" "unlock prints raw session token"
: > "$FAKE_LOG"
assert_eq "$(BW_SESSION=existing-token secret unlock)" "existing-token" "unlock reuses the env session without prompting"
assert_eq "$(rg -c -- 'unlock-env:' "$FAKE_LOG" || echo 0)" "0" "unlock does not prompt when a session is present"
: > "$FAKE_KEYCHAIN"
BW_SESSION=existing-token secret unlock --store >/dev/null 2>&1
assert_eq "$(cat "$FAKE_KEYCHAIN" 2>/dev/null || true)" "existing-token" "unlock --store persists the env session"
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' BW_SESSION=bad-token secret unlock --store 2>&1 || true)" "secret: refusing to store a rejected session — run 'bw logout && bw login' once, then 'secret unlock --store'" "unlock refuses a rejected env session"
assert_eq "$(FAKE_UNLOCK_EMPTY=1 secret unlock --store 2>&1 || true)" "secret: bw unlock returned no session token" "unlock refuses to store an empty token"
if FAKE_BW_STATUS='{"status":"locked"}' secret unlock --store 2>&1 >/dev/null | rg -q "bw rejected the new session"; then
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
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret status 2>/dev/null)" 'locked — unlock with: export BW_SESSION="$(bw unlock --raw)"' "status locked stdout unchanged with stored session"
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

echo "secret tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
