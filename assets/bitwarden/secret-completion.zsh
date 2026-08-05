# secret zsh completions. Deployed to ~/.config/secret/secret-completion.zsh by
# modules/bitwarden.nix, sourced from programs.zsh.initContent in shell.nix.
# Covered by assets/bitwarden/test-completions.sh (stubbed compadd/compdef).

_secret_alias_cache() {
  local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/secret"
  local cache="$cache_dir/aliases"
  mkdir -p "$cache_dir"
  local mtime
  if [[ "$(uname -s)" == "Darwin" ]]; then
    mtime="$(stat -f %m "$cache" 2>/dev/null || true)"
  else
    mtime="$(stat -c %Y "$cache" 2>/dev/null || true)"
  fi
  if [[ -z "$mtime" ]] || (( $(date +%s) - mtime > 60 )); then
    secret list 2>/dev/null > "$cache"
  fi
  cat "$cache" 2>/dev/null
}

_secret() {
  # compadd + read loop instead of _describe: _describe trips zsh's
  # colon-modifier parser in this shell config ("unrecognized modifier"),
  # while plain compadd works. Keep the cache refresh on TAB only.
  local -a matches
  if (( CURRENT == 2 )); then
    matches=(status unlock lock list search get set add id totp source pull pin rotate rm delete remove unset mv init env run print global lint doctor recent history st ls g s e d pr pu so)
    compadd -X 'secret commands:' -- "${matches[@]}"
    return 0
  fi
  case "${words[CURRENT-1]}" in
    get|set|add|id|totp|source|pin|rotate|rm|delete|remove|g|s|so)
      local entry rest
      while IFS=$'\t' read -r entry rest; do
        [[ -n "$entry" ]] && matches+=("$entry")
      done < <(_secret_alias_cache)
      compadd -X 'aliases:' -- "${matches[@]}"
      ;;
  esac
}

compdef _secret secret
