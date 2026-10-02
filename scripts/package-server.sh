#!/usr/bin/env bash
# Build one installable server release for this machine's platform:
#
#   bash scripts/package-server.sh v0.7.7 [output-dir]
#
# Writes conduit-server-<version>-<os>-<arch>.tar.gz and its .sha256: the
# built client, the server, production node_modules (node-pty compiled for this
# platform and this Node), templates and the working-files lock. The Node it was
# built with is recorded, and install.sh downloads exactly that Node.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:?usage: package-server.sh <version> [output-dir]}"
OUT="${2:-$ROOT/release}"
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "unsupported OS" >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
NAME="conduit-server-$VERSION-$os-$arch"
STAGE="$(mktemp -d)/conduit"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT

[[ -f "$ROOT/conduit-web/dist/index.html" ]] || (cd "$ROOT/conduit-web" && npm run build)

mkdir -p "$STAGE/conduit-web" "$STAGE/working-files" "$OUT"
cp -R "$ROOT/conduit-web/src" "$ROOT/conduit-web/dist" "$ROOT/conduit-web/package.json" "$ROOT/conduit-web/package-lock.json" "$STAGE/conduit-web/"
cp -R "$ROOT/scripts" "$ROOT/templates" "$STAGE/"
cp "$ROOT/working-files/pyproject.toml" "$ROOT/working-files/uv.lock" "$ROOT/working-files/"*.py "$STAGE/working-files/" 2>/dev/null || true
rm -f "$STAGE/scripts/package-server.sh"
(cd "$STAGE/conduit-web" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
# What this platform never runs: other platforms' native builds (Pi's
# shrinkwrap installs esbuild for every one), onnxruntime's GPU providers, and
# packages only the browser bundle uses -- it is already built into dist.
modules="$STAGE/conduit-web/node_modules"
find "$modules" -type d -path '*/@esbuild/*' -prune ! -name "$os-$arch" -exec rm -rf {} +
find "$modules" -type d -path '*/onnxruntime-node/bin/napi-v*/*' -prune ! -name "$os" -exec rm -rf {} +
find "$modules" -type d -path "*/onnxruntime-node/bin/napi-v*/$os/*" -prune ! -name "$arch" -exec rm -rf {} +
find "$modules" -name 'libonnxruntime_providers_cuda*' -o -name 'libonnxruntime_providers_tensorrt*' | xargs rm -f
rm -rf "$modules/lucide-solid" "$modules/onnxruntime-web"
# Conduit drives Claude Code only through the user's own `claude` on PATH, so
# the SDK's bundled copy of it is never run.
rm -rf "$modules"/@anthropic-ai/claude-agent-sdk-*
find "$modules" -type d -path '*/@anthropic-ai/claude-agent-sdk-*' -prune -exec rm -rf {} +
# Local voice models' native packages are fetched on first model install
# (src/server/voice-packages.js), not shipped: they are most of the weight.
rm -rf "$modules/transcribe-cpp" "$modules/@transcribe-cpp" "$modules/@huggingface" \
  "$modules/onnxruntime-node" "$modules/onnxruntime-common" "$modules/sharp" "$modules/@img"
# node-pty is compiled for this machine; its prebuilds are for the others.
rm -rf "$modules/node-pty/prebuilds" "$modules/node-pty/deps" "$modules/node-pty/third_party"
find "$modules" -type d -path '*/@koromix/koffi-*' -prune ! -name "koffi-$os-$arch" -exec rm -rf {} +
find "$modules" -name '*.map' -type f -delete
printf '%s\n' "${VERSION#v}" >"$STAGE/VERSION"
node -p 'process.version' >"$STAGE/NODE_VERSION"
# The oldest Node it runs on (Pi's floor; the native modules are N-API, so
# any Node from here up loads them). install.sh uses one on PATH that meets it.
printf '22.19.0\n' >"$STAGE/NODE_MIN"

tar -czf "$OUT/$NAME.tar.gz" -C "$(dirname "$STAGE")" conduit
(cd "$OUT" && (sha256sum "$NAME.tar.gz" 2>/dev/null || shasum -a 256 "$NAME.tar.gz") >"$NAME.tar.gz.sha256")
echo "$OUT/$NAME.tar.gz"
