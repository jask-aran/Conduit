#!/usr/bin/env bash
# Keep a development clone's server on the tip of origin/main. Run it on a timer; each run is a no-op unless
# origin/main moved.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${CONDUIT_STATE_DIR:-$HOME/.conduit${CONDUIT_PROFILE:+-$CONDUIT_PROFILE}}"
export CONDUIT_STATE_DIR="$STATE_DIR"
export CONDUIT_DATA_ROOT="${CONDUIT_DATA_ROOT:-$STATE_DIR/data}"
LOG="$STATE_DIR/follow-main.log"
FAILED="$STATE_DIR/follow-main.failed"
mkdir -p "$STATE_DIR"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }

# One run at a time: a build can outlast the timer's interval.
exec 9>"$STATE_DIR/follow-main.lock"
flock -n 9 || exit 0

cd "$ROOT"
git fetch -q origin main
old="$(git rev-parse HEAD)" new="$(git rev-parse origin/main)"
[[ "$old" == "$new" ]] && exit 0
[[ -f "$FAILED" && "$(cat "$FAILED")" == "$new" ]] && exit 0
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then log "local edits in $ROOT; not updating to ${new:0:8}"; exit 0; fi
if ! git merge-base --is-ancestor "$old" "$new"; then log "origin/main ${new:0:8} is not a fast-forward of ${old:0:8}; not updating"; exit 0; fi

server() { bash "$ROOT/scripts/conduit-server" "$@"; }
changed="$(git diff --name-only "$old" "$new")"
touches() { grep -qE "$1" <<<"$changed"; }

build() {
  # Python tools when their lockfile moved; npm's lockfile is the build's own check (start-conduit.sh).
  if touches '^working-files/(uv\.lock|pyproject\.toml)$'; then bash .devcontainer/start-conduit.sh setup >>"$LOG" 2>&1 || return 1; fi
  bash .devcontainer/start-conduit.sh build >>"$LOG" 2>&1
}
healthy() {
  local port; port="$(sed -n 's/^CONDUIT_PORT=//p' "$STATE_DIR/conduit.env" 2>/dev/null | tail -1)"
  for _ in $(seq 1 30); do curl -fsS --max-time 3 "http://127.0.0.1:${port:-4310}/healthz" >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}
back() {
  log "$1; back to ${old:0:8}"
  echo "$new" >"$FAILED"
  git reset -q --hard "$old"
  build || log "the rebuild of ${old:0:8} failed too"
  server restart >>"$LOG" 2>&1 || true
}

log "updating ${old:0:8} -> ${new:0:8} ($(git log --format=%s -1 "$new"))"
git merge -q --ff-only "$new"
if ! touches '^(conduit-web|scripts|templates|working-files|\.devcontainer)/'; then log "nothing the server runs changed"; exit 0; fi
if ! build; then back "build of ${new:0:8} failed"; exit 1; fi
if ! server restart >>"$LOG" 2>&1 || ! healthy; then back "${new:0:8} did not come back healthy"; exit 1; fi
rm -f "$FAILED"
log "running ${new:0:8}"
