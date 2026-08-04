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
assert_eq "$(secret -h | tr '\n' ' ' | rg -o 'status\|list\|get\|set\|id\|totp\|sync\|pin\|init\|env\|print\|doctor\|recent\|history')" "status|list|get|set|id|totp|sync|pin|init|env|print|doctor|recent|history" "help lists all commands"
assert_eq "$(secret get github-token)" "old-pass" "get value"
assert_eq "$(secret g github-token)" "old-pass" "alias g maps to get"

rm -f "$FAKE_CLIP"
secret get github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "old-pass" "get --copy"

assert_eq "$(printf "x" | secret set github-token 2>&1 || true)" "secret: item already exists; pass --force to overwrite" "set blocked without force"
assert_ok bash -c 'printf "v2" | "$0" "$1" set github-token --force' "$bun_bin" "$script"
assert_ok env FAKE_GET_MISSING=1 bash -c 'printf "v3" | "$0" "$1" set github-token' "$bun_bin" "$script"
assert_eq "$(secret id github-token)" "item-1" "id resolves item id"
assert_fail secret get nope
assert_eq "$(secret totp github-token)" "123456" "totp code"
rm -f "$FAKE_CLIP"
secret totp github-token --copy
assert_eq "$(cat "$FAKE_CLIP")" "123456" "totp --copy"
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

assert_ok secret doctor
assert_fail env FAKE_GET_MISSING=1 secret doctor
assert_eq "$(FAKE_BW_STATUS='{"status":"locked"}' secret doctor 2>&1 | head -1)" 'bitwarden: locked — unlock with: export BW_SESSION="$(bw unlock --raw)"' "doctor locked hint"

assert_eq "$(secret print)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL')" "print project scope after pin"
assert_eq "$(secret pr)" "$(printf 'DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL')" "alias pr maps to print"
assert_eq "$(secret print nix)" "github-token	prod	nixfiles/github-token	password	GITHUB_TOKEN" "print nix scope"
assert_eq "$(secret print global 2>&1 || true)" "secret: no config file for global scope: $tmp/.config/secret/config.json" "print global missing config explains"
assert_eq "$(secret print bogus 2>&1 || true)" "secret: unknown scope: bogus (available: project, global, nix)" "print rejects unknown scope"

secret get github-token >/dev/null
secret history | rg -q "get.*github-token" || {
  fail=$((fail + 1))
  echo "FAIL: history records get" >&2
}
secret recent | rg -q "github-token" || {
  fail=$((fail + 1))
  echo "FAIL: recent lists used alias" >&2
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
cd "$tmp"
assert_eq "$(secret print 2>&1 || true)" "secret: no .secret.json found (searched up to \$HOME) — run 'secret init' to scaffold one, or pass --config FILE" "print outside project suggests init"

cd "$tmp/proj/sub"
assert_ok secret env --output .env

echo "secret tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
