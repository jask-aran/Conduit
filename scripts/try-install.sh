#!/usr/bin/env bash
# Try the installer from this checkout without publishing anything:
#
#   scripts/try-install.sh [--build] [install.sh options]
#
# Packages this checkout as a thin release (scripts/package-server.sh), signs
# it with the local updater key when there is one, and runs this checkout's
# install.sh against it. --sandbox (passed through) keeps it off the real
# daemon; --build rebuilds the client first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/conduit-try-install"
args=()
for arg in "$@"; do [[ "$arg" == --build ]] && (cd "$ROOT/conduit-web" && npm run build >/dev/null) || args+=("$arg"); done
rm -rf "$OUT"
archive="$(bash "$ROOT/scripts/package-server.sh" "v0.0.0-local-$(git -C "$ROOT" rev-parse --short HEAD)" "$OUT" | tail -1)"
key="$HOME/.conduit/conduit-updater.key"
if [[ -f "$key" ]]; then
  (cd "$ROOT/conduit-web" && npx --no-install tauri signer sign -f "$key" -p "$(cat "$key.password" 2>/dev/null)" "$archive" >/dev/null 2>&1) || true
fi
CONDUIT_TARBALL="$archive" exec bash "$ROOT/scripts/install.sh" "${args[@]}"
