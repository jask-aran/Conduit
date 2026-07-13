#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.conduit"
PID_FILE="$STATE_DIR/pi-web.pid"
LOG_FILE="$STATE_DIR/pi-web.log"

mkdir -p "$STATE_DIR"

if [[ "${1:-}" == "restart" && -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid"
    for _ in {1..20}; do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.25
    done
  fi
  rm -f "$PID_FILE"
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "PI WEB is already running (PID $pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT/phase-0-pi-web"

export PI_WEB_HOST="${PI_WEB_HOST:-0.0.0.0}"
export PI_WEB_PORT="${PI_WEB_PORT:-8504}"
export PI_WEB_ALLOWED_HOSTS="${PI_WEB_ALLOWED_HOSTS:-true}"

nohup npm run dev >"$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" >"$PID_FILE"

for _ in {1..30}; do
  if curl --silent --fail "http://127.0.0.1:${PI_WEB_PORT}/" >/dev/null; then
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

echo "PI WEB is still starting. Follow logs with: tail -f $LOG_FILE"
