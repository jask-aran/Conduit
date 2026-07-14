#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"
bash "$ROOT/.devcontainer/start-conduit.sh" "$mode"
bash "$ROOT/.devcontainer/start-pi-tau.sh" "$mode"
bash "$ROOT/.devcontainer/start-pi-web.sh" "$mode"
curl --silent --fail --max-time 5 http://127.0.0.1:4310/healthz >/dev/null
curl --silent --fail --max-time 5 http://127.0.0.1:3001/ >/dev/null
curl --silent --fail --max-time 5 http://127.0.0.1:8504/api/pi-web/status >/dev/null
printf '%s\n' \
  'All three Phase 0 surfaces are running:' \
  '  4310  Conduit custom chat (primary)' \
  '  3001  Pi Tau (comparator)' \
  '  8504  PI WEB (comparator)'
