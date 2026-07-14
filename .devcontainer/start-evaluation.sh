#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"
bash "$ROOT/.devcontainer/start-conduit.sh" "$mode"
bash "$ROOT/.devcontainer/start-pi-tau.sh" "$mode"
bash "$ROOT/.devcontainer/start-pi-web.sh" "$mode"
printf '%s\n' \
  'All three Phase 0 surfaces are running:' \
  '  4310  Conduit custom chat (primary)' \
  '  3001  Pi Tau (comparator)' \
  '  8504  PI WEB (comparator)'
