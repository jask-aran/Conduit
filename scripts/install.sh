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

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    cat >&2 <<'EOF'
Docker is not installed or is not usable by this account.
Run this installer from the VPS provider's root console, or install Docker first.
EOF
    exit 1
  fi

  command -v apt-get >/dev/null 2>&1 || {
    echo "Automatic Docker installation currently supports Debian and Ubuntu hosts." >&2
    exit 1
  }

  echo "Installing Docker Engine and Compose..."
  apt-get update
  if ! DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 ca-certificates curl; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin ca-certificates curl
  fi
  systemctl enable --now docker 2>/dev/null || service docker start

  docker compose version >/dev/null 2>&1 || {
    echo "Docker installed, but the Compose plugin is unavailable." >&2
    exit 1
  }
}

require curl
install_docker

mkdir -p "$INSTALL_DIR/scripts"

fetch() {
  local path="$1"
  curl --fail --silent --show-error --location \
    "$RAW_BASE/$path" \
    --output "$INSTALL_DIR/$path"
}

fetch compose.yaml
fetch Caddyfile
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
