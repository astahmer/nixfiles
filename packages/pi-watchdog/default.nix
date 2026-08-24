{
  lib,
  writeShellApplication,
  coreutils,
  gnugrep,
  gnused,
}:
writeShellApplication {
  name = "pi-watchdog";
  runtimeInputs = [
    coreutils
    gnugrep
    gnused
  ];
  meta.description = "Watch pi agent RSS; log timeline and auto-dump V8 heap snapshots past a threshold";
  # usage: pi-watchdog [threshold_mb=3072] [interval_sec=30]
  # Polls running pi processes, appends 'timestamp pid rss_mb' to
  # ~/.local/state/pi-watchdog/log, sends SIGUSR2 once per pid past threshold.
  # Target must run with --heapsnapshot-signal=SIGUSR2 for snapshots;
  # logging works regardless.
  text = ''
    threshold=''${1:-3072}
    interval=''${2:-30}
    state_dir="''${HOME}/.local/state/pi-watchdog"
    mkdir -p "$state_dir"
    log="$state_dir/log"
    sent="$state_dir/snapshotted"
    touch "$sent"

    while true; do
      while read -r pid; do
        rss_kb=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ') || continue
        [ -n "$rss_kb" ] || continue
        rss_mb=$(( rss_kb / 1024 ))
        printf '%s %s %s\n' "$(date +%s)" "$pid" "$rss_mb" >> "$log"
        if [ "$rss_mb" -ge "$threshold" ] && ! grep -qx "$pid" "$sent"; then
          if kill -USR2 "$pid" 2>/dev/null; then
            echo "$pid" >> "$sent"
            printf '%s USR2->%s (%sMB)\n' "$(date +%s)" "$pid" "$rss_mb" >> "$log"
          fi
        fi
      done < <(pgrep -f '/libexec/pi/pi')
      sleep "$interval"
    done
  '';
}
