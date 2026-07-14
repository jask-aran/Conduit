#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.conduit"
PID_FILE="$STATE_DIR/pi-web.pid"
LOG_FILE="$STATE_DIR/pi-web.log"

export PI_WEB_HOST="${PI_WEB_HOST:-0.0.0.0}"
export PI_WEB_PORT="${PI_WEB_PORT:-8504}"
export PI_WEB_ALLOWED_HOSTS="${PI_WEB_ALLOWED_HOSTS:-true}"
export CONDUIT_FILES_ROOT="${CONDUIT_FILES_ROOT:-$ROOT/app/files}"
export CONDUIT_STATE_DIR="${CONDUIT_STATE_DIR:-$ROOT/app/state}"
export PI_WEB_PROJECTS_FILE="${PI_WEB_PROJECTS_FILE:-$CONDUIT_STATE_DIR/pi-web-projects.json}"

HEALTH_URL="http://127.0.0.1:${PI_WEB_PORT}/api/pi-web/status"

mkdir -p "$STATE_DIR"
mkdir -p "$CONDUIT_FILES_ROOT" "$CONDUIT_STATE_DIR"

is_healthy() {
  curl --silent --fail --max-time 2 "$HEALTH_URL" >/dev/null
}

stop_managed_pid() {
  local pid="$1"

  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  # A PID file can outlive the process across a Codespace stop/start. Do not
  # kill a different process if Linux has reused that PID.
  if ! ps -p "$pid" -o args= 2>/dev/null | grep -Eq 'npm (run )?dev|run-manual\.mjs'; then
    return
  fi

  kill "$pid"
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || return
    sleep 0.25
  done

  kill -KILL "$pid" 2>/dev/null || true
}

if [[ "${1:-}" != "restart" ]] && is_healthy; then
  echo "PI WEB is already healthy on forwarded port ${PI_WEB_PORT}."
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"

  echo "Replacing an unhealthy or explicitly restarted PI WEB process."
  stop_managed_pid "$pid"
  rm -f "$PID_FILE"
fi

cd "$ROOT/phase-0-pi-web"

nohup npm run dev >"$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" >"$PID_FILE"

for _ in {1..30}; do
  if is_healthy; then
    echo "PI WEB is ready on forwarded port ${PI_WEB_PORT} (PID $pid)."
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "PI WEB stopped during startup. Recent logs:" >&2
    tail -n 80 "$LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

echo "PI WEB did not become healthy. Recent logs:" >&2
tail -n 80 "$LOG_FILE" >&2
exit 1
