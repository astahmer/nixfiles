#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "nixfiles-configure-nix-cache: standalone macOS only; NixOS gets these settings from the NixOS module" >&2
  exit 0
fi

nix_conf="${NIXFILES_NIX_CONF:-/etc/nix/nix.conf}"
managed_conf="${NIXFILES_MANAGED_NIX_CONF:-/etc/nix/nixfiles.conf}"
login_user="${SUDO_USER:-${NIXFILES_NIX_USER:-${USER:-}}}"

if [[ -z "$login_user" || "$login_user" == "root" ]]; then
  echo "nixfiles-configure-nix-cache: run as the normal login user so trusted-users can be configured" >&2
  exit 1
fi

if [[ ! "$login_user" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "nixfiles-configure-nix-cache: refusing an unsafe login username: $login_user" >&2
  exit 1
fi

if [[ "$nix_conf" == "/etc/nix/nix.conf" && "$EUID" -ne 0 ]]; then
  exec /usr/bin/sudo -- "$0" "$@"
fi

cache_substituters="https://cache.numtide.com https://devenv.cachix.org https://cachix.cachix.org"
cache_keys="niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g= devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw= cachix.cachix.org-1:eWNHQldwUO7G2VkjpnjDbWwy4KQ/HNxht7H4SSoMckM="
include_line="!include $managed_conf"

managed_tmp="$(mktemp "${managed_conf}.tmp.XXXXXX")"
main_tmp=""
cleanup() {
  rm -f "$managed_tmp"
  if [[ -n "$main_tmp" ]]; then
    rm -f "$main_tmp"
  fi
}
trap cleanup EXIT

printf '%s\n' \
  "# Managed by nixfiles-configure-nix-cache; edit the nixfiles source instead." \
  "trusted-users = root $login_user" \
  "extra-substituters = $cache_substituters" \
  "extra-trusted-public-keys = $cache_keys" \
  "max-jobs = auto" > "$managed_tmp"
install -m 0644 "$managed_tmp" "$managed_conf"

if [[ ! -e "$nix_conf" ]] || ! grep -Fqx "$include_line" "$nix_conf"; then
  main_tmp="$(mktemp "${nix_conf}.tmp.XXXXXX")"
  if [[ -e "$nix_conf" ]]; then
    awk -v include_line="$include_line" '{ print } END { print include_line }' "$nix_conf" > "$main_tmp"
  else
    printf '%s\n' "$include_line" > "$main_tmp"
  fi
  install -m 0644 "$main_tmp" "$nix_conf"
fi

if [[ "${NIXFILES_SKIP_RESTART:-0}" != "1" ]]; then
  /bin/launchctl kickstart -k system/org.nixos.nix-daemon
fi

if [[ "${NIXFILES_SKIP_VERIFY:-0}" != "1" ]]; then
  effective_config="$(nix config show)"
  for cache in https://cache.numtide.com https://devenv.cachix.org https://cachix.cachix.org; do
    if ! printf '%s\n' "$effective_config" | grep -Fq "$cache"; then
      echo "nixfiles-configure-nix-cache: daemon did not report $cache" >&2
      exit 1
    fi
  done
fi

echo "nixfiles-configure-nix-cache: configured binary caches and max-jobs=auto"
