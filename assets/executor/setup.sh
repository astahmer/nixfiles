#!/usr/bin/env bash
# Seeder script for the local Executor catalog.
# Idempotent: safe to re-run after home-manager switch.
set -euo pipefail

EXECUTOR_DIR="${HOME}/.executor"
EXECUTOR_AUTH_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/executor"
EXECUTOR_AUTH_FILE="${EXECUTOR_AUTH_DIR}/auth.json"
GITHUB_TOKEN_FILE="${HOME}/.config/opencode/github-token"

export EXECUTOR_SCOPE_DIR="${EXECUTOR_DIR}"

if ! command -v executor >/dev/null 2>&1; then
  echo "executor is not on PATH. Install it first (home-manager activation handles this)." >&2
  exit 1
fi

ensure_executor_dirs() {
  mkdir -p "${EXECUTOR_DIR}" "${EXECUTOR_AUTH_DIR}"
}

# Read the last JSON object printed by executor call.
extract_json() {
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8").trim();
    const matches = raw.match(/\{[\s\S]*\}$/);
    if (!matches) { console.error("No JSON object found in output"); process.exit(1); }
    console.log(matches[0]);
  '
}

seed_github_token() {
  local token=""
  if [ -f "${GITHUB_TOKEN_FILE}" ]; then
    token="$(tr -d "[:space:]" < "${GITHUB_TOKEN_FILE}")"
  fi
  if [ -z "${token}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
    token="${GITHUB_TOKEN}"
  fi
  if [ -z "${token}" ] && [ -n "${GH_TOKEN:-}" ]; then
    token="${GH_TOKEN}"
  fi
  if [ -z "${token}" ] && command -v gh >/dev/null 2>&1; then
    token="$(gh auth token 2>/dev/null || true)"
  fi
  if [ -z "${token}" ]; then
    echo "No GitHub token found; skipping GitHub Copilot connection." >&2
    return 1
  fi

  local current="{}"
  if [ -f "${EXECUTOR_AUTH_FILE}" ]; then
    current="$(cat "${EXECUTOR_AUTH_FILE}")"
  fi
  local updated
  updated="$(TOKEN="${token}" node -e '
    const fs = require("fs");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
    data["github-token"] = process.env.TOKEN;
    fs.writeFileSync(1, JSON.stringify(data, null, 2));
  ' <<< "${current}")"
  printf '%s\n' "${updated}" > "${EXECUTOR_AUTH_FILE}"
  chmod 600 "${EXECUTOR_AUTH_FILE}"
}

call() {
  local output
  local exit_code=0
  output=$(executor call "$@" 2>&1) || exit_code=$?

  printf '%s\n' "${output}"

  local execution_id
  execution_id=$(printf '%s\n' "${output}" | grep -oE 'executionId: (exec_[A-Za-z0-9-]+)' | head -n1 | cut -d' ' -f2)

  if [ -n "${execution_id}" ]; then
    echo "Auto-resuming execution ${execution_id}" >&2
    executor resume --execution-id "${execution_id}" --base-url http://localhost:4789 --action accept --content '{}' 2>&1 || true
  fi

  return ${exit_code}
}

integration_exists() {
  local slug="$1"
  local out
  if ! out="$(call executor.coreTools.integrations.list '{"query":"'"${slug}"'"}' 2>/dev/null | extract_json)"; then
    return 1
  fi
  node -e '
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const list = data?.data?.integrations ?? data?.result?.integrations ?? data?.integrations ?? [];
    process.exit(list.some((i) => i.slug === process.argv[1]) ? 0 : 1);
  ' "${slug}" <<< "${out}"
}

connection_exists() {
  local integration="$1"
  local out
  if ! out="$(call executor.coreTools.connections.list '{"integration":"'"${integration}"'"}' 2>/dev/null | extract_json)"; then
    return 1
  fi
  node -e '
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const list = data?.data?.connections ?? data?.result?.connections ?? data?.connections ?? [];
    process.exit(list.some((c) => c.integration === process.argv[1]) ? 0 : 1);
  ' "${integration}" <<< "${out}"
}

add_github() {
  if integration_exists github; then
    echo "GitHub Copilot integration already exists; skipping add."
  else
    call executor.mcp.addServer '{
      "transport": "remote",
      "name": "GitHub Copilot",
      "slug": "github",
      "endpoint": "https://api.githubcopilot.com/mcp/",
      "remoteTransport": "auto",
      "authenticationTemplate": [
        {
          "type": "apiKey",
          "headers": {
            "Authorization": [
              { "type": "variable", "name": "token" }
            ]
          }
        }
      ]
    }'
  fi

  seed_github_token || true
  if connection_exists github; then
    echo "GitHub Copilot connection already exists; skipping create."
  else
    call executor.coreTools.connections.create '{
      "owner": "org",
      "name": "default",
      "integration": "github",
      "template": "default",
      "inputs": {
        "token": { "from": { "provider": "file", "id": "github-token" } }
      }
    }'
  fi
}

add_context7() {
  if integration_exists context7; then
    echo "Context7 integration already exists; skipping add."
    return 0
  fi

  if [ -n "${CONTEXT7_API_KEY:-}" ]; then
    call executor.mcp.addServer '{
      "transport": "stdio",
      "name": "Context7",
      "slug": "context7",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@1.0.31"],
      "env": { "CONTEXT7_API_KEY": "'"${CONTEXT7_API_KEY}"'" }
    }'
  else
    call executor.mcp.addServer '{
      "transport": "remote",
      "name": "Context7",
      "slug": "context7",
      "endpoint": "https://mcp.context7.com/mcp",
      "remoteTransport": "auto",
      "authenticationTemplate": [{ "kind": "none" }]
    }'
    if ! connection_exists context7; then
      call executor.coreTools.connections.create '{
        "owner": "org",
        "name": "default",
        "integration": "context7",
        "template": "none"
      }'
    fi
  fi
}

add_chrome_devtools() {
  if integration_exists chrome-devtools; then
    echo "Chrome DevTools integration already exists; skipping add."
  else
    call executor.mcp.addServer '{
      "transport": "stdio",
      "name": "Chrome DevTools",
      "slug": "chrome-devtools",
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp"]
    }'
  fi
}

add_nixos() {
  if integration_exists nixos; then
    echo "nixos integration already exists; skipping add."
  else
    call executor.mcp.addServer '{
      "transport": "stdio",
      "name": "nixos",
      "slug": "nixos",
      "command": "uvx",
      "args": ["mcp-nixos"]
    }'
  fi
}

main() {
  ensure_executor_dirs
  add_github
  add_context7
  add_chrome_devtools
  add_nixos
  echo "Executor integrations seeded."
}

main "$@"
