#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

cd "$ROOT"

if [[ "$MODE" == "restart" ]]; then
  bash .devcontainer/start-pi-tau.sh restart
  bash .devcontainer/start-pi-web.sh restart
else
  bash .devcontainer/start-pi-tau.sh
  bash .devcontainer/start-pi-web.sh
fi

curl --silent --fail --max-time 5 http://127.0.0.1:3001/ >/dev/null
curl --silent --fail --max-time 5 http://127.0.0.1:8504/api/pi-web/status >/dev/null

printf '%s\n' \
  'Both evaluation applications are ready:' \
  '  Pi Tau Web Server: http://127.0.0.1:3001' \
  '  PI WEB:            http://127.0.0.1:8504' \
  'Open their forwarded ports from the Codespace Ports panel.'
