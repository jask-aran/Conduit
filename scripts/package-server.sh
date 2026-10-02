#!/usr/bin/env bash
# Build a thin server release for this platform:
#
#   scripts/package-server.sh <version> [output-dir]
#
# Source, the built client, templates and the lockfile -- no node_modules.
# install.sh installs dependencies on the target with scripts/release-deps.mjs,
# so the download is a few MB and npm's cache makes updates cheap. The one
# native module, node-pty, ships prebuilt (it is the only thing that makes the
# archive per-platform); it uses N-API, so any Node from NODE_MIN up loads it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?usage: package-server.sh <version> [output-dir]}"
OUT="${2:-$ROOT/release}"
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "unsupported OS" >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
NAME="conduit-server-$VERSION-$os-$arch"
STAGE="$(mktemp -d)/conduit"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT

# A client older than its source is rebuilt: a stale dist would ship last
# week's interface under this week's version.
built="$ROOT/conduit-web/dist/index.html"
if [[ ! -f "$built" ]] || [[ -n "$(find "$ROOT/conduit-web/src" "$ROOT/conduit-web/index.html" "$ROOT/conduit-web/package.json" -newer "$built" -print -quit)" ]]; then
  (cd "$ROOT/conduit-web" && npm run build >&2)
fi
pty="$ROOT/conduit-web/node_modules/node-pty/build/Release"
[[ -f "$pty/pty.node" ]] || { echo "node-pty is not built here; run npm ci in conduit-web" >&2; exit 1; }

mkdir -p "$STAGE/conduit-web" "$STAGE/working-files" "$STAGE/prebuilt/node-pty/build" "$OUT"
cp -R "$ROOT/conduit-web/dist" "$ROOT/conduit-web/package.json" "$ROOT/conduit-web/package-lock.json" "$STAGE/conduit-web/"
# The server's source; the client's is already built into dist.
(cd "$ROOT/conduit-web" && find src -path src/client -prune -o -path src/components -prune -o -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name '*.html' \) -print \
  | while read -r file; do mkdir -p "$STAGE/conduit-web/$(dirname "$file")"; cp "$file" "$STAGE/conduit-web/$file"; done)
cp -R "$ROOT/scripts" "$ROOT/templates" "$STAGE/"
rm -rf "$STAGE/scripts/package-server.sh" "$STAGE/scripts/probes"
cp "$ROOT/working-files/pyproject.toml" "$ROOT/working-files/uv.lock" "$STAGE/working-files/"
cp "$ROOT/working-files/"*.py "$STAGE/working-files/" 2>/dev/null || true
cp -R "$pty" "$STAGE/prebuilt/node-pty/build/Release"
rm -rf "$STAGE/prebuilt/node-pty/build/Release/obj.target" "$STAGE/prebuilt/node-pty/build/Release/.deps"

printf '%s\n' "${VERSION#v}" >"$STAGE/VERSION"
# The Node a private copy would be, and the oldest Node it runs on (Pi's floor).
node -p 'process.version' >"$STAGE/NODE_VERSION"
printf '22.19.0\n' >"$STAGE/NODE_MIN"

tar -czf "$OUT/$NAME.tar.gz" -C "$(dirname "$STAGE")" conduit
(cd "$OUT" && (sha256sum "$NAME.tar.gz" 2>/dev/null || shasum -a 256 "$NAME.tar.gz") >"$NAME.tar.gz.sha256")
echo "$OUT/$NAME.tar.gz"
