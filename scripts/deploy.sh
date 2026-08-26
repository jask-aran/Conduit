#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
COMMAND="${1:-up}"

usage() {
  printf '%s\n' \
    "Usage: ./scripts/deploy.sh [up|restart|auth|down|status|logs|config]" \
    "" \
    "up        Prepare directories, configure the hostname, provision auth when" \
    "          absent, pull images, and start Conduit with automatic HTTPS." \
    "restart   Pull and replace the running containers without changing data." \
    "auth      Set or replace the Conduit login password." \
    "down      Stop and remove the deployment containers." \
    "status    Show container and health state." \
    "logs      Follow deployment logs." \
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
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

set_env_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

read_tty() {
  local prompt="$1" value
  if [[ -r /dev/tty ]]; then
    read -r -p "$prompt" value </dev/tty
  else
    read -r -p "$prompt" value
  fi
  printf '%s' "$value"
}

prepare_domain() {
  load_env
  local domain="${CONDUIT_DOMAIN:-}"
  if [[ -z "$domain" || "$domain" == "conduit.example.com" ]]; then
    domain="$(read_tty 'Public hostname (for example conduit.example.com): ')"
  fi
  domain="${domain#http://}"
  domain="${domain#https://}"
  domain="${domain%%/*}"
  if [[ ! "$domain" =~ ^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$ ]]; then
    echo "Enter a valid public hostname whose DNS already points to this server." >&2
    exit 1
  fi
  set_env_value CONDUIT_DOMAIN "${domain,,}"
  load_env
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

latest_published_release() {
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/jask-aran/Conduit/releases/latest" |
    sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' |
    head -n 1
}

running_release() {
  local container_id
  container_id="$(compose ps -q conduit)"
  [[ -n "$container_id" ]] || return 0
  docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$container_id"
}

should_pull_latest_release() {
  if [[ "${CONDUIT_IMAGE:-ghcr.io/jask-aran/conduit}" != "ghcr.io/jask-aran/conduit" ||
        "${CONDUIT_RELEASE:-latest}" != "latest" ]]; then
    return 0
  fi

  local published running
  published="$(latest_published_release)"
  [[ -n "$published" ]] || {
    echo "Could not identify the latest published Conduit release. No image was pulled." >&2
    exit 1
  }
  running="$(running_release)"
  if [[ "$running" == "$published" ]]; then
    echo "Conduit $published is already running; skipping the image pull."
    return 1
  fi
  echo "Conduit ${running:-not installed} -> $published is ready; pulling the published image."
}

prepare_release() {
  load_env
  case "${CONDUIT_DEPLOY_MODE:-image}" in
    image)
      if should_pull_latest_release; then
        compose pull
      fi
      ;;
    build)
      [[ -f "$ROOT/compose.build.yaml" && -f "$ROOT/Dockerfile" ]] || {
        echo "Source-build mode requires a full Conduit checkout." >&2
        exit 1
      }
      sed -i "s/^CONDUIT_RELEASE=.*/CONDUIT_RELEASE=$(release_id)/" "$ENV_FILE"
      load_env
      compose build --pull conduit
      compose pull caddy
      ;;
    *)
      echo "CONDUIT_DEPLOY_MODE must be 'image' or 'build'." >&2
      exit 1
      ;;
  esac
}

set_password() {
  local password confirmation
  if [[ -r /dev/tty ]]; then
    read -r -s -p "New password: " password </dev/tty
    printf '\n' >/dev/tty
    [[ -n "$password" ]] || { echo "Password cannot be empty." >&2; exit 1; }
    read -r -s -p "Confirm password: " confirmation </dev/tty
    printf '\n' >/dev/tty
    [[ "$password" == "$confirmation" ]] || { echo "Passwords do not match." >&2; exit 1; }
  else
    IFS= read -r password || true
    [[ -n "$password" ]] || { echo "Password cannot be empty." >&2; exit 1; }
  fi
  printf '%s' "$password" | compose run --rm --no-deps -T conduit node scripts/conduit-auth.mjs set-password --stdin
}

show_access_url() {
  load_env
  echo "Open Conduit at https://${CONDUIT_DOMAIN}"
}

if [[ "$COMMAND" == "help" || "$COMMAND" == "-h" || "$COMMAND" == "--help" ]]; then
  usage
  exit 0
fi

require_docker
prepare_env
prepare_domain

case "$COMMAND" in
  up)
    prepare_directories
    prepare_release
    auth_file="$(host_path "${CONDUIT_DATA_DIR:-./data}")/auth.json"
    if [[ ! -s "$auth_file" ]]; then
      echo "Set the single-user Conduit login password."
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
  logs) compose logs --follow ;;
  config) compose config ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage >&2
    exit 2
    ;;
esac
