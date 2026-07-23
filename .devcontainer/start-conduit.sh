#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT/conduit-web"
STATE_DIR="${CONDUIT_STATE_DIR:-$HOME/.conduit}"
PID_FILE="$STATE_DIR/conduit.pid"
LOG_FILE="$STATE_DIR/conduit.log"
VITE_PID_FILE="$STATE_DIR/conduit-vite.pid"
VITE_LOG_FILE="$STATE_DIR/conduit-vite.log"
COMMAND="${1:-restart}"
if [[ $# -gt 0 ]]; then shift; fi

export CONDUIT_HOST="${CONDUIT_HOST:-0.0.0.0}"
export CONDUIT_PORT="${CONDUIT_PORT:-4310}"
export CONDUIT_VITE_PORT="${CONDUIT_VITE_PORT:-5173}"
export CONDUIT_VITE_HOST="${CONDUIT_VITE_HOST:-0.0.0.0}"
export CONDUIT_FILES_ROOT="${CONDUIT_FILES_ROOT:-$ROOT/data/chat/files}"
export CONDUIT_CATALOG_FILE="${CONDUIT_CATALOG_FILE:-$ROOT/data/conduit.json}"
export CONDUIT_SESSION_REGISTRY_FILE="${CONDUIT_SESSION_REGISTRY_FILE:-$ROOT/data/sessions.json}"
export CONDUIT_PI_AGENT_DIR="${CONDUIT_PI_AGENT_DIR:-$ROOT/data/pi}"
export CONDUIT_PI_TEMPLATE="${CONDUIT_PI_TEMPLATE:-$ROOT/templates/chat/template.json}"
HEALTH_URL="http://127.0.0.1:${CONDUIT_PORT}/healthz"

usage() {
  cat <<'EOF'
Usage: bash .devcontainer/start-conduit.sh <command>

Commands:
  setup                 Install the pinned web server and Isolated Pi packages.
  build                 Compile the production client bundle.
  start                 Start an existing production build.
  dev                   Start the server watcher and Vite client with hot reload.
  stop                  Gracefully stop Conduit and its resident Pi processes.
  restart               Rebuild if sources changed, then restart (default).
  status                Report the managed process and health endpoint.
  logs [server|vite] [-f]
                        Show a managed log (follow with -f).
  deploy                Run setup, build, and restart.

`restart` is the normal production-like path. `dev` is the client hot-reload
path; it manages both the server watcher (port ${CONDUIT_PORT}) and Vite
(port ${CONDUIT_VITE_PORT}) and is never used for deployment.
EOF
}

prepare_dirs() {
  mkdir -p "$STATE_DIR" "$CONDUIT_FILES_ROOT" "$CONDUIT_PI_AGENT_DIR" || {
    echo "Conduit cannot create its state directories. Set CONDUIT_STATE_DIR to a writable directory if needed." >&2
    return 1
  }
}

is_healthy() {
  curl --silent --fail --max-time 2 "$HEALTH_URL" >/dev/null
}

pid_is_server() {
  local pid="$1"
  process_is_running "$pid" \
    && ps -p "$pid" -o args= 2>/dev/null | grep -Eq '(^|[[:space:]/])node([[:space:]]|$).*src/server\.js'
}

pid_is_vite() {
  local pid="$1"
  process_is_running "$pid" \
    && ps -p "$pid" -o args= 2>/dev/null | grep -Eq '(^|[[:space:]/])vite([[:space:]]|$)'
}

process_is_running() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null \
    && ! ps -p "$pid" -o stat= 2>/dev/null | grep -q '^[[:space:]]*Z'
}

managed_pid_from_file() {
  local file="$1"
  local checker="$2"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(<"$file")"
  if "$checker" "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi
  rm -f "$file"
  return 1
}

managed_pid() { managed_pid_from_file "$PID_FILE" pid_is_server; }
managed_vite_pid() { managed_pid_from_file "$VITE_PID_FILE" pid_is_vite; }

require_dependencies() {
  if [[ ! -x "$WEB_DIR/node_modules/.bin/vite" ]]; then
    echo "Conduit dependencies are not installed. Run: bash .devcontainer/start-conduit.sh setup" >&2
    exit 1
  fi
}

setup() {
  prepare_dirs || return
  echo "Installing Conduit's pinned web and Isolated Pi dependencies."
  (cd "$WEB_DIR" && npm ci)
}

build() {
  require_dependencies
  echo "Building the production Conduit client."
  (cd "$WEB_DIR" && npm run build)
}

build_if_needed() {
  require_dependencies
  if [[ ! -f "$WEB_DIR/dist/index.html" ]] \
    || find "$WEB_DIR"/index.html "$WEB_DIR"/vite.config.js "$WEB_DIR"/package.json "$WEB_DIR"/package-lock.json "$WEB_DIR"/src \
      -type f -newer "$WEB_DIR/dist/index.html" -print -quit | grep -q .; then
    build
  fi
}

start_server() {
  local watch="${1:-false}"
  prepare_dirs || return
  require_dependencies
  if [[ "$watch" != "true" && ! -f "$WEB_DIR/dist/index.html" ]]; then
    echo "No production build found. Run: bash .devcontainer/start-conduit.sh build" >&2
    exit 1
  fi
  if pid="$(managed_pid)"; then
    echo "Conduit is already managed as PID $pid on port ${CONDUIT_PORT}."
    return
  fi
  if [[ "$watch" == "true" ]]; then
    nohup setsid node --watch "$WEB_DIR/src/server.js" >"$LOG_FILE" 2>&1 </dev/null &
  else
    nohup setsid node "$WEB_DIR/src/server.js" >"$LOG_FILE" 2>&1 </dev/null &
  fi
  pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"
  for _ in {1..30}; do
    if is_healthy; then
      echo "Conduit is ready on port ${CONDUIT_PORT} (PID $pid)."
      echo "Logs: $LOG_FILE"
      return
    fi
    if ! process_is_running "$pid"; then
      rm -f "$PID_FILE"
      tail -n 100 "$LOG_FILE" >&2 || true
      exit 1
    fi
    sleep 1
  done
  echo "Conduit did not become healthy within 30 seconds." >&2
  tail -n 100 "$LOG_FILE" >&2 || true
  exit 1
}

start() { start_server false; }

start_vite() {
  require_dependencies
  local pid
  if pid="$(managed_vite_pid)"; then
    echo "Vite is already managed as PID $pid on port ${CONDUIT_VITE_PORT}."
    return
  fi
  nohup setsid "$WEB_DIR/node_modules/.bin/vite" --host "$CONDUIT_VITE_HOST" --port "$CONDUIT_VITE_PORT" >"$VITE_LOG_FILE" 2>&1 </dev/null &
  pid=$!
  printf '%s\n' "$pid" >"$VITE_PID_FILE"
  for _ in {1..30}; do
    if curl --silent --fail --max-time 2 "http://127.0.0.1:${CONDUIT_VITE_PORT}/" >/dev/null; then
      echo "Vite hot reload is ready on port ${CONDUIT_VITE_PORT} (PID $pid)."
      echo "Logs: $VITE_LOG_FILE"
      return
    fi
    if ! process_is_running "$pid"; then
      rm -f "$VITE_PID_FILE"
      tail -n 100 "$VITE_LOG_FILE" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "Vite did not become ready within 30 seconds." >&2
  tail -n 100 "$VITE_LOG_FILE" >&2 || true
  return 1
}

stop() {
  prepare_dirs || return
  local pid
  if pid="$(managed_vite_pid)"; then
    echo "Stopping Vite (PID $pid)."
    kill -TERM "$pid"
    for _ in {1..20}; do
      if ! process_is_running "$pid"; then break; fi
      sleep 0.5
    done
    if process_is_running "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
    rm -f "$VITE_PID_FILE"
  fi
  if ! pid="$(managed_pid)"; then
    echo "Conduit is not running."
    return
  fi
  echo "Stopping Conduit (PID $pid)."
  kill -TERM "$pid"
  for _ in {1..20}; do
    if ! process_is_running "$pid"; then
      rm -f "$PID_FILE"
      echo "Conduit stopped."
      return
    fi
    sleep 0.5
  done
  echo "Conduit did not stop gracefully; sending SIGKILL." >&2
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

status() {
  prepare_dirs || return
  local pid
  if ! pid="$(managed_pid)"; then
    echo "Conduit is stopped."
    return 3
  fi
  if is_healthy; then
    echo "Conduit is healthy on port ${CONDUIT_PORT} (PID $pid)."
    if pid="$(managed_vite_pid)"; then
      echo "Vite hot reload is running on port ${CONDUIT_VITE_PORT} (PID $pid)."
    fi
    return
  fi
  echo "Conduit is running as PID $pid but health checks are failing. Logs: $LOG_FILE" >&2
  return 1
}

logs() {
  prepare_dirs || return
  local log_file="$LOG_FILE"
  if [[ "${1:-}" == "vite" ]]; then
    log_file="$VITE_LOG_FILE"
    shift
  elif [[ "${1:-}" == "server" ]]; then
    shift
  fi
  touch "$log_file"
  if [[ $# -eq 0 ]]; then
    tail -n 100 "$log_file"
  else
    tail "$@" "$log_file"
  fi
}

case "$COMMAND" in
  setup) setup ;;
  build) build ;;
  start) start ;;
  dev)
    stop || true
    start_server true
    if ! start_vite; then
      stop || true
      exit 1
    fi
    ;;
  stop) stop ;;
  restart)
    stop || true
    build_if_needed
    start
    ;;
  status) status ;;
  logs) logs "$@" ;;
  deploy)
    setup
    build
    stop || true
    start
    ;;
  help|-h|--help) usage ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac
