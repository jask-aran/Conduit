#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
COMMAND="${1:-up}"

usage() {
  printf '%s\n' \
    "Usage: ./scripts/deploy.sh [up|restart|auth|down|status|logs|config]" \
    "" \
    "up        Prepare directories, pull the selected image, provision auth when" \
    "          absent, and start Conduit (default)." \
    "restart   Pull and replace the running container without changing data." \
    "auth      Set or replace the Conduit login password." \
    "down      Stop and remove the application container." \
    "status    Show the container and health state." \
    "logs      Follow application logs." \
    "config    Render the resolved Compose configuration."
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "Docker Engine with the Compose plugin is required." >&2
    exit 1
  fi
}

release_id() {
  if [[ -f "$ROOT/.conduit-release" ]]; then
    sed -n 's/^commit=//p' "$ROOT/.conduit-release" | head -n 1
  elif git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local sha
    sha="$(git -C "$ROOT" rev-parse HEAD)"
    if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
      printf 'development-%s\n' "${sha:0:12}"
    else
      printf '%s\n' "$sha"
    fi
  else
    printf '%s\n' "development"
  fi
}

prepare_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ROOT/.env.example" "$ENV_FILE"
    sed -i \
      -e "s/^CONDUIT_UID=.*/CONDUIT_UID=$(id -u)/" \
      -e "s/^CONDUIT_GID=.*/CONDUIT_GID=$(id -g)/" \
      "$ENV_FILE"
    echo "Created $ENV_FILE."
  fi
}

load_env() {
  set -a
  # .env is deployment configuration owned by the operator.
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

host_path() {
  if [[ "$1" = /* ]]; then printf '%s\n' "$1"
  else realpath -m "$ROOT/$1"
  fi
}

prepare_directories() {
  load_env
  local data_dir workspaces_dir
  data_dir="$(host_path "${CONDUIT_DATA_DIR:-./data}")"
  workspaces_dir="$(host_path "${CONDUIT_WORKSPACES_DIR:-../workspaces}")"
  mkdir -p "$data_dir" "$workspaces_dir"
  if [[ ! -w "$data_dir" || ! -w "$workspaces_dir" ]]; then
    echo "Deployment directories must be writable by UID ${CONDUIT_UID:-$(id -u)}." >&2
    exit 1
  fi
}

compose() {
  local files=(-f compose.yaml)
  if [[ "${CONDUIT_DEPLOY_MODE:-image}" == "build" ]]; then
    files+=(-f compose.build.yaml)
  fi
  (cd "$ROOT" && docker compose --project-name "${CONDUIT_COMPOSE_PROJECT_NAME:-conduit}" --env-file "$ENV_FILE" "${files[@]}" "$@")
}

prepare_release() {
  load_env
  case "${CONDUIT_DEPLOY_MODE:-image}" in
    image)
      compose pull conduit
      ;;
    build)
      [[ -f "$ROOT/compose.build.yaml" && -f "$ROOT/Dockerfile" ]] || {
        echo "Source-build mode requires a full Conduit checkout." >&2
        exit 1
      }
      sed -i "s/^CONDUIT_RELEASE=.*/CONDUIT_RELEASE=$(release_id)/" "$ENV_FILE"
      load_env
      compose build --pull conduit
      ;;
    *)
      echo "CONDUIT_DEPLOY_MODE must be 'image' or 'build'." >&2
      exit 1
      ;;
  esac
}

set_password() {
  local password confirmation
  if [[ -t 0 ]]; then
    read -r -s -p "New password: " password
    printf '\n'
    [[ -n "$password" ]] || { echo "Password cannot be empty." >&2; exit 1; }
    read -r -s -p "Confirm password: " confirmation
    printf '\n'
    [[ "$password" == "$confirmation" ]] || { echo "Passwords do not match." >&2; exit 1; }
  else
    IFS= read -r password || true
    [[ -n "$password" ]] || { echo "Password cannot be empty." >&2; exit 1; }
  fi
  printf '%s' "$password" | compose run --rm --no-deps -T conduit node scripts/conduit-auth.mjs set-password --stdin
}

show_access_url() {
  load_env
  local bind_address="${CONDUIT_BIND_ADDRESS:-0.0.0.0}"
  local port="${CONDUIT_PORT:-80}"
  if [[ "$bind_address" == "0.0.0.0" ]]; then
    if [[ "$port" == "80" ]]; then
      echo "Open Conduit at http://<server-public-ip>"
    else
      echo "Open Conduit at http://<server-public-ip>:$port"
    fi
  elif [[ "$port" == "80" ]]; then
    echo "Conduit is listening at http://$bind_address"
  else
    echo "Conduit is listening at http://$bind_address:$port"
  fi
}

if [[ "$COMMAND" == "help" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  usage
  exit 0
fi

require_docker
prepare_env
load_env

case "$COMMAND" in
  up)
    prepare_directories
    prepare_release
    auth_file="$(host_path "${CONDUIT_DATA_DIR:-./data}")/auth.json"
    if [[ ! -s "$auth_file" ]]; then
      echo "Conduit needs its single-user login password."
      set_password
    fi
    compose up -d --remove-orphans
    compose ps
    show_access_url
    ;;
  restart)
    prepare_directories
    prepare_release
    compose up -d --force-recreate --remove-orphans
    compose ps
    show_access_url
    ;;
  auth)
    prepare_directories
    prepare_release
    set_password
    compose up -d --force-recreate
    show_access_url
    ;;
  down) compose down ;;
  status) compose ps ;;
  logs) compose logs --follow conduit ;;
  config) compose config ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac
