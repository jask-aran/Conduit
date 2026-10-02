#!/usr/bin/env bash
# Install Conduit on this computer:
#
#   curl -fsSL https://get.jask-aran.com/conduit | bash
#
# Downloads the latest release for this platform and the Node it runs on into
# ~/.local/share/conduit, puts `conduit` on PATH, and runs `conduit setup`.
# Nothing needs root. Re-running it updates Conduit; your data in ~/.conduit
# is never touched.
#
#   --version v0.7.7   install that release
#   --no-setup         install only; run `conduit setup` later
#   --update           update in place (what `conduit update` runs)
#   CONDUIT_TARBALL=…  install from a local release tarball (testing)
set -euo pipefail

REPOSITORY="${CONDUIT_REPOSITORY:-jask-aran/Conduit}"
APP_HOME="${CONDUIT_APP_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/conduit}"
BIN_DIR="${CONDUIT_BIN_DIR:-$HOME/.local/bin}"
VERSION=""; SETUP=1; UPDATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --no-setup) SETUP=0; shift ;;
    --update) UPDATE=1; SETUP=0; shift ;;
    *) shift ;;
  esac
done

if [[ -t 1 ]]; then
  B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else B=""; D=""; G=""; R=""; C=""; N=""; fi
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
fail() { printf '\n  %s✗%s %s\n\n' "$R" "$N" "$*" >&2; exit 1; }
spin() { # spin "message" command... : a one-line spinner, replaced by ✓ or ✗
  local message="$1"; shift
  local log; log="$(mktemp)"
  "$@" >"$log" 2>&1 &
  local pid=$! frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  if [[ -t 1 ]]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  %s%s%s %s' "$C" "${frames:i++%${#frames}:1}" "$N" "$message"; sleep 0.08
    done
    printf '\r\e[K'
  fi
  if wait "$pid"; then ok "$message"; rm -f "$log"
  else printf '  %s✗%s %s\n' "$R" "$N" "$message"; sed 's/^/    /' "$log" | tail -20 >&2; rm -f "$log"; exit 1; fi
}

for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."; done

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "Conduit runs on Linux and macOS. On Windows, run this inside WSL." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) fail "No Conduit build for $(uname -m)." ;;
esac
platform="$os-$arch"

printf '\n  %sConduit%s %sinstaller%s\n\n' "$B" "$N" "$D" "$N"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [[ -n "${CONDUIT_TARBALL:-}" ]]; then
  cp "$CONDUIT_TARBALL" "$work/conduit.tar.gz"
  ok "Using $(basename "$CONDUIT_TARBALL")"
else
  if [[ -z "$VERSION" ]]; then
    VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest" | sed 's#.*/tag/##')"
    [[ "$VERSION" == v* ]] || fail "Could not find the latest Conduit release."
  fi
  asset="conduit-server-$VERSION-$platform.tar.gz"
  base="https://github.com/$REPOSITORY/releases/download/$VERSION"
  fetch_release() {
    curl -fsSL "$base/$asset" -o "$work/conduit.tar.gz"
    curl -fsSL "$base/$asset.sha256" -o "$work/conduit.sha256"
    local expected; expected="$(awk '{print $1}' "$work/conduit.sha256")"
    local actual; actual="$( (sha256sum "$work/conduit.tar.gz" 2>/dev/null || shasum -a 256 "$work/conduit.tar.gz") | awk '{print $1}')"
    [[ "$expected" == "$actual" ]] || { echo "Checksum mismatch for $asset"; return 1; }
  }
  spin "Downloading Conduit $VERSION for $platform" fetch_release
fi

mkdir -p "$work/release"
tar -xzf "$work/conduit.tar.gz" -C "$work/release" --strip-components=1
release_version="$(cat "$work/release/VERSION")"
node_version="$(cat "$work/release/NODE_VERSION")"

node_dir="$APP_HOME/node/$node_version"
if [[ ! -x "$node_dir/bin/node" ]]; then
  fetch_node() {
    local name="node-$node_version-$os-$arch"
    curl -fsSL "https://nodejs.org/dist/$node_version/$name.tar.gz" -o "$work/node.tar.gz"
    mkdir -p "$node_dir"
    tar -xzf "$work/node.tar.gz" -C "$node_dir" --strip-components=1
  }
  spin "Downloading Node $node_version" fetch_node
else
  ok "Node $node_version"
fi

install_release() {
  mkdir -p "$APP_HOME/versions" "$BIN_DIR"
  rm -rf "$APP_HOME/versions/$release_version"
  mv "$work/release" "$APP_HOME/versions/$release_version"
  ln -sfn "$APP_HOME/versions/$release_version" "$APP_HOME/current"
  ln -sfn "$APP_HOME/current/scripts/conduit" "$BIN_DIR/conduit"
  # Keep the two newest releases, for `conduit rollback`.
  ls -1t "$APP_HOME/versions" | tail -n +3 | while read -r old; do rm -rf "${APP_HOME:?}/versions/$old"; done
}
spin "Installing to $APP_HOME" install_release

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '  %s·%s Add %s to your PATH: %sexport PATH="%s:$PATH"%s\n' "$D" "$N" "$BIN_DIR" "$B" "$BIN_DIR" "$N" ;;
esac

if (( UPDATE )); then
  spin "Updating the Python tools" "$BIN_DIR/conduit" _sync-python
  exec "$BIN_DIR/conduit" restart
fi
if (( SETUP )) && [[ -r /dev/tty ]]; then
  exec "$BIN_DIR/conduit" setup
fi
printf '\n  Run %sconduit setup%s to finish.\n\n' "$B" "$N"
