#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${CONDUIT_REPOSITORY:-jask-aran/Conduit}"
REF="${CONDUIT_INSTALL_REF:-main}"
INSTALL_DIR="${CONDUIT_INSTALL_DIR:-$HOME/conduit}"
RAW_BASE="https://raw.githubusercontent.com/${REPOSITORY}/${REF}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "$1 is required." >&2
    exit 1
  }
}

require curl

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Docker Engine with the Compose plugin is required.
Install Docker using your VPS image or provider instructions, then rerun this command.
EOF
  exit 1
fi

mkdir -p "$INSTALL_DIR/scripts"

fetch() {
  local path="$1"
  curl --fail --silent --show-error --location \
    "$RAW_BASE/$path" \
    --output "$INSTALL_DIR/$path"
}

fetch compose.yaml
fetch .env.example
fetch scripts/deploy.sh
fetch scripts/backup.sh
fetch scripts/restore.sh

chmod +x \
  "$INSTALL_DIR/scripts/deploy.sh" \
  "$INSTALL_DIR/scripts/backup.sh" \
  "$INSTALL_DIR/scripts/restore.sh"

printf 'Installed Conduit deployment files in %s.\n' "$INSTALL_DIR"
cd "$INSTALL_DIR"
exec ./scripts/deploy.sh up
