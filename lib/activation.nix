# Shell helpers shared by Home Manager activation snippets. Source the result
# with `. ${activationLib}` at the top of a snippet.
{ pkgs }:
let
  coreutils = "${pkgs.coreutils}/bin";
in
pkgs.writeText "nixfiles-activation-lib.sh" ''
  # nixfiles_step <scope> <step> <time-limit> <command...>
  # Runs the command under a hard time limit and logs start, duration and
  # exit status as `[nixfiles:<scope>] <step> ...` on stderr.
  nixfiles_step() {
    local scope="$1" step="$2" limit="$3"
    shift 3
    local started="$SECONDS" status=0
    printf '[nixfiles:%s] %s started\n' "$scope" "$step" >&2
    ${coreutils}/timeout --kill-after=5s "$limit" "$@" || status="$?"
    local elapsed=$((SECONDS - started))
    if [ "$status" -eq 0 ]; then
      printf '[nixfiles:%s] %s completed in %ss\n' "$scope" "$step" "$elapsed" >&2
    else
      printf '[nixfiles:%s] %s failed after %ss (status %s)\n' "$scope" "$step" "$elapsed" "$status" >&2
    fi
    return "$status"
  }

  nixfiles_launch_agent_bootout() {
    ${coreutils}/timeout --kill-after=2s 8s \
      /bin/launchctl bootout "gui/$(/usr/bin/id -u)/$1" >/dev/null 2>&1 || true
  }

  # nixfiles_launch_agent_install <label> <plist>
  # Replaces ~/Library/LaunchAgents/<label>.plist and (re)bootstraps it.
  nixfiles_launch_agent_install() {
    local label="$1" source="$2"
    local agents_dir="$HOME/Library/LaunchAgents"
    local destination="$agents_dir/$label.plist"
    ${coreutils}/mkdir -p "$agents_dir"
    nixfiles_launch_agent_bootout "$label"
    ${coreutils}/install -m 600 "$source" "$destination.next.$$"
    ${coreutils}/mv -f "$destination.next.$$" "$destination"

    # bootout deregisters asynchronously: launchd can briefly refuse a
    # same-label bootstrap ("Input/output error") right after.
    local attempt=1
    until nixfiles_step launchd "$label bootstrap" 8s \
      /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$destination"; do
      if [ "$attempt" -ge 5 ]; then
        return 1
      fi
      ${coreutils}/sleep 1
      attempt=$((attempt + 1))
    done
  }
''
