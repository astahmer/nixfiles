#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev
node benchmark/run.mjs
