#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"

usage() {
  echo "Usage: ./scripts/restore.sh <backup.tar.gz>" >&2
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

manifest_value() {
  sed -n "s/^$1=//p" "$MANIFEST" | head -n 1
}

target_is_empty() {
  [[ ! -e "$1" ]] || [[ -z "$(find "$1" -mindepth 1 -print -quit)" ]]
}

verify_checksums() {
  local record encoded_path expected logical_path actual_path actual
  while IFS= read -r record; do
    [[ "$record" == file=$'\t'* ]] && continue
    [[ "$record" == file=* ]] || continue
    encoded_path="${record#file=}"
    expected="${encoded_path#*$'\t'}"
    encoded_path="${encoded_path%%$'\t'*}"
    logical_path="$(printf '%s' "$encoded_path" | base64 -d)"
    actual_path="$STAGING/$logical_path"
    [[ -f "$actual_path" ]] || { echo "Backup manifest file is missing: $logical_path" >&2; exit 1; }
    actual="$(sha256sum "$actual_path" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || { echo "Checksum mismatch for $logical_path" >&2; exit 1; }
  done <"$MANIFEST"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

require_docker
for command in tar gzip sha256sum base64 find realpath cp; do require_command "$command"; done
ARCHIVE="$(realpath "$ARCHIVE")"
MANIFEST="$ARCHIVE.manifest"
[[ -f "$ARCHIVE" ]] || { echo "Backup archive does not exist: $ARCHIVE" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "Backup manifest does not exist: $MANIFEST" >&2; exit 1; }
[[ "$(manifest_value format)" == "conduit-backup-v1" ]] || { echo "Unsupported backup manifest." >&2; exit 1; }
EXPECTED_ARCHIVE_SHA256="$(manifest_value archive_sha256)"
ACTUAL_ARCHIVE_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ -n "$EXPECTED_ARCHIVE_SHA256" && "$ACTUAL_ARCHIVE_SHA256" == "$EXPECTED_ARCHIVE_SHA256" ]] || {
  echo "Backup archive checksum does not match its manifest." >&2
  exit 1
}

STAGING="$(mktemp -d)"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT
tar --acls --xattrs --numeric-owner --same-owner -xpf "$ARCHIVE" -C "$STAGING"
[[ -f "$STAGING/.env" && -d "$STAGING/data" && -d "$STAGING/workspaces" ]] || {
  echo "Backup archive is missing .env, data, or workspaces." >&2
  exit 1
}
verify_checksums

TARGET_ENV_FILE="$ROOT/.env"
TARGET_ENV_EXISTS=false
if [[ -f "$TARGET_ENV_FILE" ]]; then
  TARGET_ENV_EXISTS=true
fi
set -a
# A target-owned .env selects independent mount roots. Otherwise preserve the
# archived portable layout exactly.
# shellcheck disable=SC1090
if [[ "$TARGET_ENV_EXISTS" == true ]]; then
  source "$TARGET_ENV_FILE"
else
  source "$STAGING/.env"
fi
set +a

compose() {
  (cd "$ROOT" && docker compose --project-name "${CONDUIT_COMPOSE_PROJECT_NAME:-conduit}" -f compose.yaml "$@")
}

if [[ -n "$(compose ps -q)" ]]; then
  echo "Refusing restore while this Compose deployment is running; run ./scripts/deploy.sh down first." >&2
  exit 1
fi

DATA_DIRECTORY="$(host_path "${CONDUIT_DATA_DIR:-./data}")"
WORKSPACES_DIRECTORY="$(host_path "${CONDUIT_WORKSPACES_DIR:-../workspaces}")"
target_is_empty "$DATA_DIRECTORY" || { echo "Refusing to overwrite non-empty data directory: $DATA_DIRECTORY" >&2; exit 1; }
target_is_empty "$WORKSPACES_DIRECTORY" || { echo "Refusing to overwrite non-empty workspaces directory: $WORKSPACES_DIRECTORY" >&2; exit 1; }

mkdir -p "$DATA_DIRECTORY" "$WORKSPACES_DIRECTORY"
cp -a "$STAGING/data/." "$DATA_DIRECTORY/"
cp -a "$STAGING/workspaces/." "$WORKSPACES_DIRECTORY/"
if [[ "$TARGET_ENV_EXISTS" == false ]]; then
  cp -p "$STAGING/.env" "$ROOT/.env"
fi

printf 'Restored release %s into %s and %s.\n' "$(manifest_value release)" "$DATA_DIRECTORY" "$WORKSPACES_DIRECTORY"
