# Deployed by modules/shell.nix: `secret unlock` exports BW_SESSION into the
# current shell. Everything else delegates to the CLI. Help flags are passed
# through untouched, and flag variants (--store/--helper) go through the CLI
# so Touch ID and keychain behavior stay in one place.
secret() {
  if [[ "$1" == "unlock" ]]; then
    if [[ " $* " == *" -h "* || " $* " == *" --help "* ]]; then
      command secret "$@"
      return $?
    fi
    local token=""
    if [[ "$*" == *"--store"* ]]; then
      command secret unlock --store || return 1
      if [[ "$(uname -s)" == "Darwin" ]]; then
        token="$(security find-generic-password -a bitwarden-session -s secret-cli -w 2>/dev/null || true)"
      fi
      if [[ -z "$token" ]]; then
        token="$(cat "${SECRET_SESSION_FILE:-$HOME/.config/secret/session}" 2>/dev/null || true)"
      fi
    else
      token="$(command secret "$@")" || return 1
    fi
    if [[ -n "$token" ]]; then
      export BW_SESSION="$token"
      echo "secret: unlocked for this shell"
    else
      echo "secret: unlock produced no session token" >&2
      return 1
    fi
  elif [[ "$1" == "lock" ]]; then
    unset BW_SESSION
    command secret "$@"
  else
    command secret "$@"
  fi
}
