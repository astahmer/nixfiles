#!/usr/bin/env bash
# Shell-function regression for assets/bitwarden/secret-shell.zsh: unlock must
# export BW_SESSION into the current shell, help flags must pass through to the
# CLI untouched, and --store/--helper must reach the CLI (keychain + Touch ID).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SECRET_SHELL_FN="$root/assets/bitwarden/secret-shell.zsh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/config/secret"

cat > "$tmp/bin/secret" <<'EOF'
#!/bin/sh
echo "cli:$*" >> "$FAKE_SHELL_LOG"
case " $* " in
  *" --helper "*) printf 'helper-token' ;;
  *" -h "*) printf 'help-text-for-unlock' ;;
  *" --store "*) printf '' ;;
  *) printf 'token-123' ;;
esac
EOF
chmod +x "$tmp/bin/secret"

cat > "$tmp/bin/security" <<'EOF'
#!/bin/sh
case "$1" in
  find-generic-password) printf '%s' "$FAKE_STORED" ;;
  *) exit 44 ;;
esac
EOF
chmod +x "$tmp/bin/security"

export PATH="$tmp/bin:$PATH"
export FAKE_SHELL_LOG="$tmp/log.txt"
export FAKE_STORED="stored-token"

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
assert_contains() {
  if printf '%s\n' "$1" | rg -q --fixed-strings "$2"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $3" >&2
    echo "  expected to contain: $2" >&2
    echo "  got:      $1" >&2
  fi
}

if ! command -v zsh >/dev/null 2>&1; then
  echo "skipping shell-function tests (zsh not on PATH)" >&2
  echo "secret shell tests: 0 passed, 0 failed (skipped)"
  exit 0
fi

zsh_run() {
  zsh -f -c 'source "$SECRET_SHELL_FN"; '"$1"
}

: > "$FAKE_SHELL_LOG"
assert_eq "$(zsh_run 'secret unlock -h')" "help-text-for-unlock" "unlock -h shows help through the shell function"
assert_eq "$(rg -c -- 'cli:unlock -h' "$FAKE_SHELL_LOG" || echo 0)" "1" "unlock -h delegates to the CLI"

: > "$FAKE_SHELL_LOG"
assert_eq "$(zsh_run 'secret unlock; printf "|%s|" "$BW_SESSION"')" $'secret: unlocked for this shell\n|token-123|' "unlock exports the session into the shell"
assert_eq "$(rg -c -- 'cli:unlock$' "$FAKE_SHELL_LOG" || echo 0)" "1" "plain unlock delegates to the CLI"

: > "$FAKE_SHELL_LOG"
assert_eq "$(zsh_run 'secret unlock --helper; printf "|%s|" "$BW_SESSION"')" $'secret: unlocked for this shell\n|helper-token|' "unlock --helper exports the Touch ID session"
assert_eq "$(rg -c -- 'cli:unlock --helper' "$FAKE_SHELL_LOG" || echo 0)" "1" "unlock --helper reaches the CLI"

: > "$FAKE_SHELL_LOG"
assert_eq "$(zsh_run 'secret unlock --store; printf "|%s|" "$BW_SESSION"')" $'secret: unlocked for this shell\n|stored-token|' "unlock --store exports the stored session"
assert_eq "$(rg -c -- 'cli:unlock --store' "$FAKE_SHELL_LOG" || echo 0)" "1" "unlock --store delegates to the CLI"

echo "secret shell tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
