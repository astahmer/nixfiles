#!/usr/bin/env bash
# Fake-bw regression suite for assets/bitwarden/secret.ts.
# Self-contained: builds a fake bw/pbcopy, a temp HOME, and asserts behavior
# without touching a real vault or the network.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/assets/bitwarden/secret.ts"
bun_bin="${BUN:-bun}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/config/secret" "$tmp/proj/sub"

cat > "$tmp/bin/bw" <<'EOF'
#!/bin/sh
case "$1" in
  status) printf "%s" "$FAKE_BW_STATUS" ;;
  generate) printf "%s" "gen-pass-123" ;;
  sync) printf "%s\n" "-- sync --" >> "$FAKE_LOG" ;;
  get)
    if [ "$2" = "totp" ]; then printf "%s" "123456"; exit 0; fi
    printf "%s\n" "-- get $3 --" >> "$FAKE_LOG"
    if [ -n "$FAKE_GET_MISSING" ]; then echo "not found" >&2; exit 1; fi
    printf '{"id":"item-1","name":"%s","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}' "$3"
    ;;
  create) printf "%s\n" "-- create --" >> "$FAKE_LOG"; cat >> "$FAKE_LOG" ;;
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

cat > "$tmp/config/secret/defaults.json" <<'EOF'
{
  "secrets": {
    "github-token": { "item": "nixfiles/github-token", "field": "password", "env": "GITHUB_TOKEN" }
  }
}
EOF

cat > "$tmp/proj/.secret.json" <<'EOF'
{
  "secrets": {
    "DATABASE_URL": { "item": "myapp/database-url", "field": "password" }
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
export SECRET_DEFAULTS_FILE="$tmp/config/secret/defaults.json"
export HOME="$tmp"
export FAKE_LOG="$tmp/log.txt"
export FAKE_CLIP="$tmp/clip.txt"
export FAKE_BW_STATUS='{"status":"unlocked"}'

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
assert_eq "$(secret -h | tr '\n' ' ' | rg -o 'status\|list\|search\|get\|set\|id\|totp\|pull\|pin\|rotate\|rm\|unset\|mv\|init\|env\|print\|lint\|doctor\|recent\|history')" "status|list|search|get|set|id|totp|pull|pin|rotate|rm|unset|mv|init|env|print|lint|doctor|recent|history" "help lists all commands"
assert_eq "$(secret get github-token)" "old-pass" "get value"
assert_eq "$(secret g github-token)" "old-pass" "alias g maps to get"

rm -f "$FAKE_CLIP"
secret get github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "old-pass" "get --copy"

assert_eq "$(printf "x" | secret set github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "set blocked without force"
assert_ok bash -c 'printf "v2" | "$0" "$1" set github-token --force' "$bun_bin" "$script"
assert_ok env FAKE_GET_MISSING=1 bash -c 'printf "v3" | "$0" "$1" set github-token' "$bun_bin" "$script"
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

assert_ok secret pin DATABASE_URL
rg -q '"item": "item-1"' "$tmp/proj/.secret.json" && pass=$((pass + 1)) || {
  fail=$((fail + 1))
  echo "FAIL: pin rewrites item names to ids" >&2
}
assert_eq "$(secret pin github-token 2>&1 || true)" "secret: alias github-token is only in the Nix-managed $tmp/config/secret/defaults.json; copy it to a project or user config to pin" "pin refuses Nix-managed defaults"
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

assert_eq "$(secret print)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL')" "print project scope after pin"
assert_eq "$(secret pr)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL')" "alias pr maps to print"
assert_eq "$(secret print nix)" "github-token	prod	nixfiles/github-token	password	GITHUB_TOKEN" "print nix scope"
assert_eq "$(secret print global 2>&1 || true)" "secret: no config file for global scope: $tmp/.config/secret/config.json" "print global missing config explains"
assert_eq "$(secret print bogus 2>&1 || true)" "secret: unknown scope: bogus (available: project, global, nix, local)" "print rejects unknown scope"
assert_eq "$(secret print --all)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tnix\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN')" "print --all merges scopes"
assert_eq "$(secret search database)" "$(printf 'DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL')" "search matches alias and env key"
assert_eq "$(secret search github --json)" "[{\"alias\":\"github-token\",\"scope\":\"nix\",\"env\":\"prod\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"}]" "search --json rows"
assert_eq "$(secret search nope 2>&1 || true)" "secret search: no matches for 'nope'. next: try another term, or 'secret print --all'" "search no match exits nonzero"
assert_eq "$(secret print --json)" "[{\"alias\":\"DATABASE_URL\",\"env\":\"dev\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"},{\"alias\":\"DATABASE_URL\",\"env\":\"prod\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"}]" "print --json rows after pin"
assert_eq "$(secret list --json)" "[{\"alias\":\"github-token\",\"item\":\"nixfiles/github-token\",\"field\":\"password\",\"envKey\":\"GITHUB_TOKEN\"},{\"alias\":\"DATABASE_URL\",\"item\":\"item-1\",\"field\":\"password\",\"envKey\":\"DATABASE_URL\"}]" "list --json merged aliases after pin"
if command -v script >/dev/null 2>&1; then
  script -q "$tmp/list-tty.txt" "$bun_bin" "$script" list >/dev/null 2>&1 || true
  tr -d '\r\b' < "$tmp/list-tty.txt" | rg -q 'ALIAS' && pass=$((pass + 1)) || {
    fail=$((fail + 1))
    echo "FAIL: list prints a table on a TTY" >&2
  }
else
  pass=$((pass + 1))
fi
assert_eq "$(secret env --export)" "export DATABASE_URL='old-pass'" "env --export shell lines"
printf "DATABASE_URL='stale'\n" > .env
assert_eq "$(secret env --diff --output .env)" "- DATABASE_URL='stale'
+ DATABASE_URL='old-pass'" "env --diff shows changes without writing"
assert_eq "$(cat .env)" "DATABASE_URL='stale'" "env --diff leaves file untouched"
cd "$tmp/proj/sub"
assert_ok secret env --output .env
cd "$tmp/proj"

assert_ok secret mv DATABASE_URL DB_URL
assert_eq "$(secret print | head -1)" "DB_URL	dev	item-1	password	DB_URL" "mv renames base and env overrides"
assert_ok secret mv DB_URL DATABASE_URL
assert_eq "$(secret mv DATABASE_URL BAD-NAME 2>&1 || true)" "secret: invalid alias name: BAD-NAME (letters, digits, underscore; must not start with a digit)" "mv rejects invalid alias name"
assert_eq "$(secret mv github-token GH 2>&1 || true)" "secret: alias github-token is only in the Nix-managed $tmp/config/secret/defaults.json; copy it to a project or user config to rename it" "mv refuses Nix-managed defaults"
assert_ok secret u DATABASE_URL
assert_fail secret get DATABASE_URL
assert_eq "$(secret unset DATABASE_URL 2>&1 || true)" "secret: alias DATABASE_URL is only in the Nix-managed $tmp/config/secret/defaults.json; copy it to a project or user config to remove it" "unset second time reports defaults-only"
assert_eq "$(secret unset github-token 2>&1 || true)" "secret: alias github-token is only in the Nix-managed $tmp/config/secret/defaults.json; copy it to a project or user config to remove it" "unset refuses Nix-managed defaults"

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
assert_eq "$(secret list)" "$(printf 'github-token\tnixfiles/github-token\tpassword\nBASE\tlocal/item\tpassword\nEXTRA\tlocal/extra\tpassword')" "local overrides project item and adds alias"
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
cd "$tmp"

echo "secret tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
