#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm install --omit=dev --silent 2>/dev/null || npm install --omit=dev
node --test test/smoke.test.mjs
