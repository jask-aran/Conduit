#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-HEAD}"
OUTPUT_DIR="${2:-$ROOT/release}"

if ! git -C "$ROOT" rev-parse --verify "${REF}^{commit}" >/dev/null 2>&1; then
  echo "Not a Git commit: $REF" >&2
  exit 2
fi

SHA="$(git -C "$ROOT" rev-parse "${REF}^{commit}")"
SHORT_SHA="${SHA:0:12}"
COMMIT_TIME="$(git -C "$ROOT" show -s --format=%ct "$SHA")"
VERSION="$(git -C "$ROOT" show "$SHA:conduit-web/package.json" \
  | node -e 'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).version));')"
NAME="conduit-${VERSION}-${SHORT_SHA}"
TEMP_ROOT="$(mktemp -d)"
BUNDLE="$TEMP_ROOT/$NAME"
ARTIFACT="$OUTPUT_DIR/$NAME.tar.gz"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$BUNDLE" "$OUTPUT_DIR"
git -C "$ROOT" archive --format=tar "$SHA" | tar -xf - -C "$BUNDLE"
sed -i \
  -e "s/^CONDUIT_RELEASE=.*/CONDUIT_RELEASE=$SHA/" \
  -e "s/^CONDUIT_DEPLOY_MODE=.*/CONDUIT_DEPLOY_MODE=build/" \
  "$BUNDLE/.env.example"
printf 'commit=%s\nversion=%s\n' "$SHA" "$VERSION" >"$BUNDLE/.conduit-release"

tar --sort=name \
  --mtime="@$COMMIT_TIME" \
  --owner=0 --group=0 --numeric-owner \
  -C "$TEMP_ROOT" -cf - "$NAME" \
  | gzip -n >"$ARTIFACT"
sha256sum "$ARTIFACT" >"$ARTIFACT.sha256"

printf 'Created %s\n' "$ARTIFACT"
printf 'Commit  %s\n' "$SHA"
printf 'SHA256  %s\n' "$(cut -d ' ' -f 1 "$ARTIFACT.sha256")"
