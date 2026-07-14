#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.conduit"
PID_FILE="$STATE_DIR/pi-tau.pid"
LOG_FILE="$STATE_DIR/pi-tau.log"

export TAU_HOST="${TAU_HOST:-0.0.0.0}"
export TAU_PORT="${TAU_PORT:-3001}"
export TAU_PROJECTS_DIR="${TAU_PROJECTS_DIR:-$ROOT}"

HEALTH_URL="http://127.0.0.1:${TAU_PORT}/api/health"

mkdir -p "$STATE_DIR"

is_healthy() {
  curl --silent --fail --max-time 2 "$HEALTH_URL" >/dev/null
}

stop_managed_pid() {
  local pid="$1"

  if ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  # PID files survive a Codespace stop/start. Avoid killing an unrelated
  # process if Linux has reused the old PID.
  if ! ps -p "$pid" -o args= 2>/dev/null | grep -Eq 'pi-tau-web-server|bin/tau\.js'; then
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
  echo "Pi Tau is already healthy on forwarded port ${TAU_PORT}."
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  echo "Replacing an unhealthy or explicitly restarted Pi Tau process."
  stop_managed_pid "$pid"
  rm -f "$PID_FILE"
fi

cd "$ROOT/phase-0-pi-tau"

PI_TAU_DIR="${PI_TAU_DIR:-$HOME/.conduit/upstream/pi-tau-web-server}"

nohup node "$PI_TAU_DIR/bin/tau.js" \
  --host "$TAU_HOST" \
  --port "$TAU_PORT" \
  --projects-dir "$TAU_PROJECTS_DIR" \
  >"$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" >"$PID_FILE"

for _ in {1..30}; do
  if is_healthy; then
    echo "Pi Tau is ready on forwarded port ${TAU_PORT} (PID $pid)."
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Pi Tau stopped during startup. Recent logs:" >&2
    tail -n 80 "$LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

echo "Pi Tau did not become healthy. Recent logs:" >&2
tail -n 80 "$LOG_FILE" >&2
exit 1
