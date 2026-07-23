#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.conduit"
PID_FILE="$STATE_DIR/conduit.pid"
LOG_FILE="$STATE_DIR/conduit.log"
export CONDUIT_HOST="${CONDUIT_HOST:-0.0.0.0}"
export CONDUIT_PORT="${CONDUIT_PORT:-4310}"
# The dev container binds a non-loopback address. First run presents the
# guarded browser setup page instead of opening the entire application.
export CONDUIT_ALLOW_BOOTSTRAP="${CONDUIT_ALLOW_BOOTSTRAP:-1}"
export CONDUIT_FILES_ROOT="${CONDUIT_FILES_ROOT:-$ROOT/data/chat/files}"
export CONDUIT_CATALOG_FILE="${CONDUIT_CATALOG_FILE:-$ROOT/data/conduit.json}"
export CONDUIT_SESSION_REGISTRY_FILE="${CONDUIT_SESSION_REGISTRY_FILE:-$ROOT/data/sessions.json}"
export CONDUIT_PI_AGENT_DIR="${CONDUIT_PI_AGENT_DIR:-$ROOT/data/pi}"
export CONDUIT_PI_TEMPLATE="${CONDUIT_PI_TEMPLATE:-$ROOT/templates/chat/template.json}"
HEALTH_URL="http://127.0.0.1:${CONDUIT_PORT}/healthz"
mkdir -p "$STATE_DIR" "$CONDUIT_FILES_ROOT" "$CONDUIT_PI_AGENT_DIR"

is_healthy() { curl --silent --fail --max-time 2 "$HEALTH_URL" >/dev/null; }
if [[ "${1:-}" != "restart" ]] && is_healthy; then echo "Conduit is already healthy on ${CONDUIT_PORT}."; exit 0; fi
if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= | grep -q 'conduit-web.*server.js\|src/server.js'; then kill "$pid" || true; fi
  rm -f "$PID_FILE"
fi
cd "$ROOT/conduit-web"
if [[ ! -f dist/index.html ]] || find index.html vite.config.js package.json package-lock.json src -type f -newer dist/index.html -print -quit | grep -q .; then
  echo "Building the current Conduit frontend."
  npm run build
fi
nohup setsid node src/server.js >"$LOG_FILE" 2>&1 </dev/null & pid=$!; echo "$pid" >"$PID_FILE"
for _ in {1..30}; do
  if is_healthy; then echo "Conduit is ready on forwarded port ${CONDUIT_PORT} (PID $pid)."; echo "Logs: $LOG_FILE"; exit 0; fi
  kill -0 "$pid" 2>/dev/null || { tail -n 100 "$LOG_FILE" >&2; exit 1; }
  sleep 1
done
tail -n 100 "$LOG_FILE" >&2; exit 1
