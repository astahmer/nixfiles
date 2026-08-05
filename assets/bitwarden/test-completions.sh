#!/usr/bin/env bash
# Completion regression suite for assets/bitwarden/secret-completion.{zsh,bash}.
# Runs the completion functions with stubbed compadd/compgen/compdef so no
# terminal or vault is needed; guards the _describe breakage and alias parsing.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SECRET_COMP_ZSH="$root/assets/bitwarden/secret-completion.zsh"
export SECRET_COMP_BASH="$root/assets/bitwarden/secret-completion.bash"

pass=0
fail=0
assert_contains() {
  if printf '%s\n' "$1" | rg -q --fixed-strings "$2"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $3" >&2
    echo "  expected to contain: $2" >&2
    echo "  got:" >&2
    printf '%s\n' "$1" | sed 's/^/    /' >&2
  fi
}
assert_no_errors() {
  if printf '%s\n' "$1" | rg -q "unrecognized modifier|bad substitution|command not found"; then
    fail=$((fail + 1))
    echo "FAIL: $2" >&2
    printf '%s\n' "$1" | sed 's/^/    /' >&2
  else
    pass=$((pass + 1))
  fi
}

if command -v zsh >/dev/null 2>&1; then
  zsh_out="$(zsh -f 2>&1 <<'ZSH'
# Stubs: record what the completion offers, ignore the rest.
compadd() {
  local -a args words
  args=("$@")
  local sep=0 i
  for (( i = 1; i <= $#args; i++ )); do
    [[ "${args[$i]}" = "--" ]] && sep=$i
  done
  for (( i = sep + 1; i <= $#args; i++ )); do
    print -r -- "OFFER:${args[$i]}"
  done
}
compdef() { :; }
_secret_alias_cache() {
  printf 'github-token\tnixfiles/github-token\tpassword\ngemini-api-key\tnixfiles/gemini-api-key\tpassword\n'
}
source "$SECRET_COMP_ZSH"

words=(secret g)
CURRENT=2
_secret

words=(secret get gi)
CURRENT=3
_secret
print -r -- "DONE"
ZSH
)"
  assert_contains "$zsh_out" "OFFER:status" "zsh offers command words"
  assert_contains "$zsh_out" "OFFER:get" "zsh offers get"
  assert_contains "$zsh_out" "OFFER:g" "zsh offers alias g"
  assert_contains "$zsh_out" "OFFER:github-token" "zsh offers aliases from the cache"
  assert_contains "$zsh_out" "OFFER:gemini-api-key" "zsh offers both aliases"
  assert_no_errors "$zsh_out" "zsh completion runs without expansion errors"
else
  echo "skipping zsh completion tests (zsh not on PATH)" >&2
fi

bash_out="$(bash --noprofile --norc -c '
source "$1"
_secret_alias_cache() { printf "github-token\n"; }
COMP_WORDS=(secret get)
COMP_CWORD=1
_secret
printf "CMD:%s\n" "${COMPREPLY[@]}"
COMP_WORDS=(secret get gi)
COMP_CWORD=2
_secret
printf "ALIAS:%s\n" "${COMPREPLY[@]}"
' _ "$SECRET_COMP_BASH")"
assert_contains "$bash_out" "CMD:get" "bash offers command words"
assert_contains "$bash_out" "ALIAS:github-token" "bash offers aliases from the cache"
assert_no_errors "$bash_out" "bash completion runs without errors"

echo "completion tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
