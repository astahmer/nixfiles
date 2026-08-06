# secret bash completions. Deployed to ~/.config/secret/secret-completion.bash
# by modules/bitwarden.nix, sourced from programs.bash.initExtra in shell.nix.
# Covered by assets/bitwarden/test-completions.sh.

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
  awk -F '\t' '{print $1}' "$cache" 2>/dev/null
}

_secret() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W "status unlock lock list search get set add edit id totp source pull sync pin rotate rm delete remove unset mv init env run print global prune lint doctor recent history st ls g s e d pr pu so" -- "$cur") )
    return 0
  fi
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    get|set|add|edit|id|totp|source|pin|rotate|rm|delete|remove|g|s|so)
      COMPREPLY=( $(compgen -W "$(_secret_alias_cache)" -- "$cur") )
      ;;
  esac
}

complete -o default -F _secret secret
