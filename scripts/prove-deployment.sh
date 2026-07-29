#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="$(git -C "$ROOT" rev-parse HEAD)"
PROOF_ID="conduit-proof-${RELEASE:0:12}-$$"
EVIDENCE_ROOT="$ROOT/.deployment-evidence"
EVIDENCE_DIRECTORY="$EVIDENCE_ROOT/$PROOF_ID"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/$PROOF_ID.XXXXXX")"
PASSWORD="proof-password-${RANDOM}-${RANDOM}"
SOURCE_PROJECT="${PROOF_ID}-a"
TARGET_PROJECT="${PROOF_ID}-b"
SOURCE_PORT="$((20000 + RANDOM % 10000))"
TARGET_PORT="$((30001 + RANDOM % 10000))"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $1" >&2
    exit 1
  }
}

cleanup() {
  for release_directory in "${SOURCE_RELEASE:-}" "${TARGET_RELEASE:-}"; do
    [[ -n "$release_directory" && -d "$release_directory" ]] || continue
    local project="$SOURCE_PROJECT"
    [[ "$release_directory" == "${TARGET_RELEASE:-}" ]] && project="$TARGET_PROJECT"
    (cd "$release_directory" && CONDUIT_COMPOSE_PROJECT_NAME="$project" docker compose --env-file .env -f compose.yaml down --volumes --remove-orphans >/dev/null 2>&1) || true
  done
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

compose() {
  local release_directory="$1"
  local project="$2"
  shift 2
  (cd "$release_directory" && CONDUIT_COMPOSE_PROJECT_NAME="$project" docker compose --project-name "$project" --env-file .env -f compose.yaml "$@")
}

deploy() {
  local release_directory="$1"
  local project="$2"
  shift 2
  (cd "$release_directory" && CONDUIT_COMPOSE_PROJECT_NAME="$project" ./scripts/deploy.sh "$@")
}

wait_for_health() {
  local release_directory="$1"
  local project="$2"
  local attempt
  for attempt in $(seq 1 60); do
    if compose "$release_directory" "$project" exec -T conduit node -e '
fetch("http://127.0.0.1:4310/healthz")
  .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
  .then((health) => { if (health.status !== "ready") throw new Error(health.status); })
  .catch(() => process.exit(1));
' >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  compose "$release_directory" "$project" logs conduit >&2 || true
  echo "Conduit did not become ready within 60 seconds." >&2
  exit 1
}

write_proof_env() {
  local release_directory="$1"
  local port="$2"
  cp "$release_directory/.env.example" "$release_directory/.env"
  sed -i \
    -e "s/^CONDUIT_IMAGE=.*/CONDUIT_IMAGE=$PROOF_ID/" \
    -e "s/^CONDUIT_UID=.*/CONDUIT_UID=$(id -u)/" \
    -e "s/^CONDUIT_GID=.*/CONDUIT_GID=$(id -g)/" \
    -e "s/^CONDUIT_PORT=.*/CONDUIT_PORT=$port/" \
    "$release_directory/.env"
}

create_fixtures() {
  local release_directory="$1"
  local project="$2"
  compose "$release_directory" "$project" exec -T conduit node --input-type=module -e '
const password = process.argv[1];
const request = async (path, options = {}, cookie = "") => {
  const response = await fetch(`http://127.0.0.1:4310${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
};
const login = await request("/v0/auth/login", { method: "POST", body: JSON.stringify({ password }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const chat = await (await request("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: "project_chat" }) }, cookie)).json();
const attachmentId = crypto.randomUUID();
const attachment = Buffer.from("Conduit deployment fixture\\n");
await request(`/v0/chats/${chat.id}/attachments/${attachmentId}?name=proof.txt`, {
  method: "PUT", headers: { "content-type": "text/plain" }, body: attachment,
}, cookie);
const workspace = await (await request("/v0/projects", {
  method: "POST", body: JSON.stringify({ mode: "created", path: "/workspaces", directoryName: "proof-workspace" }),
}, cookie)).json();
const installations = await (await request("/v0/pi-installations", {}, cookie)).json();
const isolated = installations.installations.find((item) => item.id === "conduit-pinned");
const host = installations.installations.find((item) => item.id === "host-pi");
if (isolated?.version !== "0.80.6") throw new Error("Pinned Isolated Pi version is not 0.80.6");
if (host?.available) throw new Error("Host Pi must not be available in the container");
console.log(JSON.stringify({ cookie, chatId: chat.id, attachmentId, workspaceId: workspace.id, workspacePath: workspace.path, isolatedVersion: isolated.version, hostAvailable: host?.available || false }));
' "$PASSWORD"
}

verify_fixtures() {
  local release_directory="$1"
  local project="$2"
  local fixture_file="$3"
  compose "$release_directory" "$project" exec -T conduit node --input-type=module -e '
const fixture = JSON.parse(process.argv[1]);
const request = async (path, options = {}) => {
  const response = await fetch(`http://127.0.0.1:4310${path}`, {
    ...options,
    headers: { cookie: fixture.cookie, ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
};
const health = await (await request("/healthz")).json();
if (health.release !== process.argv[2] || health.status !== "ready") throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
const chat = await (await request(`/v0/chats/${fixture.chatId}`)).json();
if (chat.id !== fixture.chatId || chat.status !== "draft") throw new Error("Draft chat identity did not survive");
const attachment = await request(`/v0/chats/${fixture.chatId}/attachments/${fixture.attachmentId}`);
if (Buffer.from(await attachment.arrayBuffer()).toString() !== "Conduit deployment fixture\\n") throw new Error("Attachment content did not survive");
const projects = await (await request("/v0/projects")).json();
const workspace = projects.projects.find((project) => project.id === fixture.workspaceId);
if (workspace.id !== fixture.workspaceId || workspace.path !== "/workspaces/proof-workspace") throw new Error("Workspace registration did not survive");
const fs = await import("node:fs/promises");
if (await fs.readFile("/workspaces/proof-workspace/proof.txt", "utf8") !== "workspace fixture\\n") throw new Error("Workspace file did not survive");
const installations = await (await request("/v0/pi-installations")).json();
const isolated = installations.installations.find((item) => item.id === "conduit-pinned");
const host = installations.installations.find((item) => item.id === "host-pi");
if (isolated?.version !== fixture.isolatedVersion || host?.available) throw new Error("Pi runtime boundary changed");
console.log(JSON.stringify({ health, chatId: chat.id, attachmentId: fixture.attachmentId, workspaceId: workspace.id, hostAvailable: host?.available || false }));
' "$(<"$fixture_file")" "$RELEASE"
}

if [[ -n "$(git -C "$ROOT" diff --name-only)" || -n "$(git -C "$ROOT" diff --cached --name-only)" ]]; then
  echo "prove-deployment requires committed tracked changes so it can package the exact checked-out release." >&2
  exit 1
fi
require_command docker
docker compose version >/dev/null 2>&1 || { echo "Docker Engine with the Compose plugin is required." >&2; exit 1; }
for command in tar sha256sum sed find; do require_command "$command"; done

mkdir -p "$EVIDENCE_DIRECTORY" "$TEMP_ROOT/source" "$TEMP_ROOT/target"
"$ROOT/scripts/package-release.sh" "$RELEASE" "$TEMP_ROOT/package" | tee "$EVIDENCE_DIRECTORY/package.txt"
PACKAGE_ARCHIVE="$(find "$TEMP_ROOT/package" -maxdepth 1 -name '*.tar.gz' -print -quit)"
[[ -n "$PACKAGE_ARCHIVE" ]] || { echo "Release package was not created." >&2; exit 1; }
sha256sum -c "$PACKAGE_ARCHIVE.sha256" | tee "$EVIDENCE_DIRECTORY/package-check.txt"

tar -xzf "$PACKAGE_ARCHIVE" -C "$TEMP_ROOT/source"
SOURCE_RELEASE="$(find "$TEMP_ROOT/source" -mindepth 1 -maxdepth 1 -type d -print -quit)"
write_proof_env "$SOURCE_RELEASE" "$SOURCE_PORT"
printf '%s\n' "$PASSWORD" | deploy "$SOURCE_RELEASE" "$SOURCE_PROJECT" up | tee "$EVIDENCE_DIRECTORY/source-start.txt"
wait_for_health "$SOURCE_RELEASE" "$SOURCE_PROJECT"
create_fixtures "$SOURCE_RELEASE" "$SOURCE_PROJECT" 2>&1 | tee "$EVIDENCE_DIRECTORY/source-fixture.json"
printf 'workspace fixture\n' >"$SOURCE_RELEASE/../workspaces/proof-workspace/proof.txt"
deploy "$SOURCE_RELEASE" "$SOURCE_PROJECT" restart | tee "$EVIDENCE_DIRECTORY/source-restart.txt"
wait_for_health "$SOURCE_RELEASE" "$SOURCE_PROJECT"
verify_fixtures "$SOURCE_RELEASE" "$SOURCE_PROJECT" "$EVIDENCE_DIRECTORY/source-fixture.json" 2>&1 | tee "$EVIDENCE_DIRECTORY/source-rebuild.json"
SOURCE_CONTAINER="$(compose "$SOURCE_RELEASE" "$SOURCE_PROJECT" ps -q conduit)"
docker inspect "$SOURCE_CONTAINER" >"$EVIDENCE_DIRECTORY/source-security-inspect.json"

deploy "$SOURCE_RELEASE" "$SOURCE_PROJECT" down | tee "$EVIDENCE_DIRECTORY/source-down.txt"
CONDUIT_COMPOSE_PROJECT_NAME="$SOURCE_PROJECT" "$SOURCE_RELEASE/scripts/backup.sh" "$TEMP_ROOT/backup" | tee "$EVIDENCE_DIRECTORY/backup.txt"
BACKUP_ARCHIVE="$(find "$TEMP_ROOT/backup" -maxdepth 1 -name '*.tar.gz' -print -quit)"
cp "$BACKUP_ARCHIVE" "$TEMP_ROOT/target/backup.tar.gz"
cp "$BACKUP_ARCHIVE.manifest" "$TEMP_ROOT/target/backup.tar.gz.manifest"

tar -xzf "$PACKAGE_ARCHIVE" -C "$TEMP_ROOT/target"
TARGET_RELEASE="$(find "$TEMP_ROOT/target" -mindepth 1 -maxdepth 1 -type d -print -quit)"
CONDUIT_COMPOSE_PROJECT_NAME="$TARGET_PROJECT" "$TARGET_RELEASE/scripts/restore.sh" "$TEMP_ROOT/target/backup.tar.gz" | tee "$EVIDENCE_DIRECTORY/restore.txt"
sed -i "s/^CONDUIT_PORT=.*/CONDUIT_PORT=$TARGET_PORT/" "$TARGET_RELEASE/.env"
deploy "$TARGET_RELEASE" "$TARGET_PROJECT" up | tee "$EVIDENCE_DIRECTORY/target-start.txt"
wait_for_health "$TARGET_RELEASE" "$TARGET_PROJECT"
verify_fixtures "$TARGET_RELEASE" "$TARGET_PROJECT" "$EVIDENCE_DIRECTORY/source-fixture.json" 2>&1 | tee "$EVIDENCE_DIRECTORY/target-restore.json"

{
  printf 'release=%s\n' "$RELEASE"
  printf 'package=%s\n' "$PACKAGE_ARCHIVE"
  printf 'backup=%s\n' "$BACKUP_ARCHIVE"
  printf 'source_fixture=%s\n' "$(<"$EVIDENCE_DIRECTORY/source-fixture.json")"
  printf 'source_rebuild=%s\n' "$(<"$EVIDENCE_DIRECTORY/source-rebuild.json")"
  printf 'target_restore=%s\n' "$(<"$EVIDENCE_DIRECTORY/target-restore.json")"
  printf 'security_inspect=%s\n' "$EVIDENCE_DIRECTORY/source-security-inspect.json"
  printf 'result=passed\n'
} >"$EVIDENCE_DIRECTORY/summary.txt"
printf 'Deployment proof passed. Evidence: %s\n' "$EVIDENCE_DIRECTORY"
