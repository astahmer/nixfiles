#!/usr/bin/env bash
# cli-tools — colorful inventory of this machine's Nix CLI cockpit.
# Usage: cli-tools [--web|--term|-h]
set -euo pipefail

OVERVIEW="@overview@"

c() { # name color_code
  local code="$1"; shift
  if [[ -t 1 ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$*"
  else
    printf '%s' "$*"
  fi
}

bold() { c '1' "$@"; }
dim() { c '2' "$@"; }
green() { c '32' "$@"; }
cyan() { c '36' "$@"; }
blue() { c '34' "$@"; }
yellow() { c '33' "$@"; }
magenta() { c '35' "$@"; }
red() { c '31' "$@"; }

print_row() {
  local tool="$1" replaces="$2" blurb="$3"
  printf '  %s' "$(cyan "$tool")"
  if [[ -n "$replaces" ]]; then
    printf '  %s %s' "$(dim "←")" "$(dim "$replaces")"
  fi
  printf '\n    %s\n' "$(dim "$blurb")"
}

print_section() {
  local title="$1"
  printf '\n%s\n' "$(bold "$(green "$title")")"
}

list_term() {
  printf '%s\n' "$(bold "Nix CLI Cockpit")"
  printf '%s\n' "$(dim "Home Manager profile tools — curated map (not every bin)")"
  printf '%s %s\n' "$(dim "profile:")" "$(cyan "${HOME}/.nix-profile/bin")"

  print_section "Search & navigate"
  print_row "rg / ripgrep" "grep" "Fast project search; respects gitignore"
  print_row "fd" "find" "Friendly file finder"
  print_row "fzf" "" "Fuzzy picker (often with bat preview)"
  print_row "bat" "cat" "Syntax-highlighted file viewer"
  print_row "delta" "" "Side-by-side git diffs"
  print_row "ripdrag" "" "Drag/drop files from the terminal (GTK4)"

  print_section "Shell & envs"
  print_row "zsh + starship" "" "Interactive shell + prompt"
  print_row "mise" "" "Per-project toolchains (mise.toml → PATH)"
  print_row "direnv / nix-direnv" "" "Directory env hooks"
  print_row "nh" "" "Home Manager / NixOS apply helper (nixapply)"

  print_section "VCS & agents"
  print_row "jj / jjui / lightjj / ryu" "git UI" "Jujutsu stack + helpers"
  print_row "lazygit / lazydocker" "" "TUI for git and docker"
  print_row "drydock" "" "Live TUI for uncommitted/unpushed work across every repo"
  print_row "gh / ghui" "" "GitHub CLI + TUI"
  print_row "secret / bw / rbw" "" "Native Swift Bitwarden CLI (v2, daemon reads) + interactive clients"
  print_row "herdr / iris / opencode" "" "Agent multiplexer + command suggest + coding agent"
  print_row "cursor-agent" "" "Cursor Agent CLI for terminal and T3 Code"
  print_row "codex" "" "OpenAI Codex CLI for terminal and T3 Code"
  print_row "agy / modlens" "" "Antigravity CLI + image-to-structured-evidence for text-only agents"
  print_row "modsearch" "" "plug-in web search & page fetch for text-only agents"
  print_row "openusage" "" "AI usage and quota dashboard for the macOS menu bar"
  print_row "codexbar" "" "AI provider usage limits in the macOS menu bar"
  print_row "plannotator / nub" "" "Plan review UI + agent utils"

  print_section "Languages & runtimes"
  print_row "node / pnpm / bun / uv" "" "JS + Python toolchains"
  print_row "nvim / zed / code" "" "Editors"
  print_row "nixd / nixfmt / deadnix" "" "Nix LSP + format + dead code"

  print_section "System"
  print_row "btop / htop / ncdu" "top / du" "Process + disk"
  print_row "httpie / curl / jq" "" "HTTP + JSON"
  print_row "tmux / tokei / hyperfine" "" "Sessions, LOC, benchmarks"
  print_row "rtk" "" "Token-optimized shell wrapper"

  print_section "Nix apply"
  print_row "nixapply" "" "nh home switch -c macbook (uses NH_FLAKE)"
  print_row "nixbootstrap" "" "Install optional external tools and seed Executor"
  print_row "nixcheck" "" "Format, dead-code, whitespace, and flake validation"
  print_row "nixfiles-here" "" "ln clone → ~/.config/nixfiles"
  print_row "cli-tools --web" "" "Open this map in the browser"

  local count
  count="$(find "${HOME}/.nix-profile/bin" -maxdepth 1 -type f -o -type l 2>/dev/null | wc -l | tr -d ' ')"
  printf '\n%s %s %s\n' "$(dim "bins in profile:")" "$(yellow "$count")" "$(dim "(ls ~/.nix-profile/bin for full list)")"
}

open_web() {
  if [[ ! -f "$OVERVIEW" ]]; then
    echo "cli-tools: overview missing at $OVERVIEW" >&2
    echo "  run nixapply to deploy assets" >&2
    exit 1
  fi
  if command -v open >/dev/null 2>&1; then
    open "$OVERVIEW"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$OVERVIEW"
  else
    echo "$OVERVIEW"
  fi
}

usage() {
  cat <<'EOF'
Usage: cli-tools [--term|--web|-h]

  --term   Colorized terminal map of curated Nix CLI tools (default on TTY)
  --web    Open the HTML cockpit in a browser (default when not a TTY)
  -h       Show help
EOF
}

mode=""
case "${1:-}" in
  -h | --help) usage; exit 0 ;;
  --term | -t) mode=term ;;
  --web | -w) mode=web ;;
  "")
    if [[ -t 1 ]]; then mode=term; else mode=web; fi
    ;;
  *)
    echo "cli-tools: unknown arg: $1" >&2
    usage >&2
    exit 2
    ;;
esac

case "$mode" in
  term) list_term ;;
  web) open_web ;;
esac
