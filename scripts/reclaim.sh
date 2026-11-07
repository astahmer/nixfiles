set +e
set -uo pipefail

state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/nixfiles"
log_file="$state_dir/reclaim.log"
profile_dir="${XDG_STATE_HOME:-$HOME/.local/state}/nix/profiles"

mkdir -p "$state_dir"

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

available_kb() {
  df -Pk / | awk 'NR == 2 { print $4 }'
}

format_gib() {
  awk -v kib="$1" 'BEGIN { printf "%.2f GiB", kib / 1048576 }'
}

log() {
  printf '%s reclaim: %s\n' "$(timestamp)" "$*" >> "$log_file"
}

before_kb="$(available_kb)"
log "start (available $(format_gib "$before_kb"))"

status=0
removed=0
current_target="$(readlink "$profile_dir/home-manager" 2>/dev/null || true)"

if [ -n "$current_target" ] && [ -d "$profile_dir" ]; then
  while IFS= read -r -d '' link; do
    [ "$(readlink "$link" || true)" = "$current_target" ] && continue
    target="$(readlink "$link" || true)"
    case "$target" in
      /nix/store/*) ;;
      *)
        log "skip $(basename "$link"): not a Nix store generation"
        continue
        ;;
    esac
    if rm -f "$link"; then
      removed=$((removed + 1))
      log "removed $(basename "$link")"
    else
      status=1
      log "failed to remove $(basename "$link")"
    fi
  done < <(find "$profile_dir" -maxdepth 1 -type l -name 'home-manager-[0-9]*-link' -mtime +14 -print0 2>/dev/null)
fi

log "pruned $removed home-manager generation(s) older than 14d"

if timeout 3600 nix-collect-garbage --delete-older-than 14d >>"$log_file" 2>&1; then
  log "nix-collect-garbage completed"
else
  collect_status=$?
  status=1
  log "nix-collect-garbage failed (exit $collect_status)"
fi

after_kb="$(available_kb)"
freed_kb=$((after_kb - before_kb))
log "end (available $(format_gib "$after_kb"); freed $(format_gib "$freed_kb"); df before ${before_kb} KiB, after ${after_kb} KiB)"

exit "$status"
