#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
OUTPUT_DIRECTORY="${1:-$ROOT/release/backups}"

usage() {
  echo "Usage: ./scripts/backup.sh [output-directory]" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $1" >&2
    exit 1
  }
}

require_docker() {
  require_command docker
  docker compose version >/dev/null 2>&1 || {
    echo "Docker Engine with the Compose plugin is required." >&2
    exit 1
  }
}

host_path() {
  if [[ "$1" = /* ]]; then
    printf '%s\n' "$1"
  else
    realpath -m "$ROOT/$1"
  fi
}

release_id() {
  if [[ -f "$ROOT/.conduit-release" ]]; then
    sed -n 's/^commit=//p' "$ROOT/.conduit-release" | head -n 1
  elif git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$ROOT" rev-parse HEAD
  else
    printf 'unknown\n'
  fi
}

append_checksum() {
  local logical_path="$1"
  local absolute_path="$2"
  local path_base64 checksum
  path_base64="$(printf '%s' "$logical_path" | base64 -w0)"
  checksum="$(sha256sum "$absolute_path" | awk '{print $1}')"
  printf 'file=%s\t%s\n' "$path_base64" "$checksum" >>"$MANIFEST"
}

append_tree_checksums() {
  local prefix="$1"
  local directory="$2"
  local file relative
  while IFS= read -r -d '' file; do
    relative="${file#"$directory"/}"
    append_checksum "$prefix/$relative" "$file"
  done < <(find "$directory" -type f -print0 | sort -z)
}

if [[ $# -gt 1 ]]; then
  usage
  exit 2
fi

require_docker
for command in tar gzip sha256sum base64 find sort stat realpath; do require_command "$command"; done
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE; run ./scripts/deploy.sh up first." >&2; exit 1; }

set -a
# .env is operator-owned Compose configuration.
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose() {
  (cd "$ROOT" && docker compose --project-name "${CONDUIT_COMPOSE_PROJECT_NAME:-conduit}" --env-file "$ENV_FILE" -f compose.yaml "$@")
}

if [[ -n "$(compose ps -q)" ]]; then
  echo "Refusing a hot backup: stop Conduit with ./scripts/deploy.sh down first." >&2
  exit 1
fi

DATA_DIRECTORY="$(host_path "${CONDUIT_DATA_DIR:-./data}")"
WORKSPACES_DIRECTORY="$(host_path "${CONDUIT_WORKSPACES_DIR:-../workspaces}")"
[[ -d "$DATA_DIRECTORY" ]] || { echo "Data directory does not exist: $DATA_DIRECTORY" >&2; exit 1; }
[[ -d "$WORKSPACES_DIRECTORY" ]] || { echo "Workspaces directory does not exist: $WORKSPACES_DIRECTORY" >&2; exit 1; }

mkdir -p "$OUTPUT_DIRECTORY"
OUTPUT_DIRECTORY="$(realpath -m "$OUTPUT_DIRECTORY")"
RELEASE="$(release_id)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$OUTPUT_DIRECTORY/conduit-backup-${RELEASE:0:12}-$TIMESTAMP.tar.gz"
MANIFEST="$ARCHIVE.manifest"
TEMP_ROOT="$(mktemp -d)"

cleanup() { rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT

tar --acls --xattrs --numeric-owner \
  --transform='s,^\.\/,data/,' -C "$DATA_DIRECTORY" -cf "$TEMP_ROOT/payload.tar" .
tar --acls --xattrs --numeric-owner \
  --transform='s,^\.\/,workspaces/,' -C "$WORKSPACES_DIRECTORY" -rf "$TEMP_ROOT/payload.tar" .
tar --acls --xattrs --numeric-owner -C "$ROOT" -rf "$TEMP_ROOT/payload.tar" .env
gzip -n <"$TEMP_ROOT/payload.tar" >"$ARCHIVE"

ARCHIVE_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
{
  printf 'format=conduit-backup-v1\n'
  printf 'release=%s\n' "$RELEASE"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'archive=%s\n' "$(basename "$ARCHIVE")"
  printf 'archive_sha256=%s\n' "$ARCHIVE_SHA256"
  printf 'data_owner=%s\n' "$(stat -c '%u:%g:%a' "$DATA_DIRECTORY")"
  printf 'workspaces_owner=%s\n' "$(stat -c '%u:%g:%a' "$WORKSPACES_DIRECTORY")"
  printf 'env_owner=%s\n' "$(stat -c '%u:%g:%a' "$ENV_FILE")"
} >"$MANIFEST"
append_checksum ".env" "$ENV_FILE"
append_tree_checksums "data" "$DATA_DIRECTORY"
append_tree_checksums "workspaces" "$WORKSPACES_DIRECTORY"

printf 'Backup archive: %s\n' "$ARCHIVE"
printf 'Manifest: %s\n' "$MANIFEST"
printf 'Release: %s\n' "$RELEASE"
printf 'Archive SHA-256: %s\n' "$ARCHIVE_SHA256"
