#!/usr/bin/env bash
# Install the Conduit server on this computer:
#
#   curl -fsSL https://get.jask-aran.com/conduit | bash
#
# Downloads the latest release for this platform and the Node it runs on into
# ~/.local/share/conduit, puts `conduit-server` on PATH, and runs its setup.
# Nothing needs root. Re-running it updates; ~/.conduit is never touched.
#
#   --version v0.7.7   install that release
#   --sandbox          a separate throwaway daemon (~/.conduit-sandbox, port 4321)
#   --no-setup         install only
#   --update           update in place (what `conduit-server update` runs)
#   CONDUIT_TARBALL=…  install from a local release archive (testing)
set -euo pipefail

REPOSITORY="${CONDUIT_REPOSITORY:-jask-aran/Conduit}"
# The release signing key (the Windows updater's): every server archive is
# checked against it before anything from it runs.
SIGNING_KEY="dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNERUM3MTI2RjQ5RDcyOEEKUldTS2NwMzBKbkhzUFhHNUd2N1N2azd3ZmUyTDNQc2xOdXBrbkN3a3BzczFoNVBHcWErVFVLaHcK"
PROFILE="${CONDUIT_PROFILE:-}"
VERSION=""; SETUP=1; UPDATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --sandbox) PROFILE=sandbox; shift ;;
    --no-setup) SETUP=0; shift ;;
    --update) UPDATE=1; SETUP=0; shift ;;
    *) shift ;;
  esac
done
SUFFIX="${PROFILE:+-$PROFILE}"
NAME="conduit-server$SUFFIX"
APP_HOME="${CONDUIT_APP_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/conduit$SUFFIX}"
BIN_DIR="${CONDUIT_BIN_DIR:-$HOME/.local/bin}"

# The same rail as conduit-server's setup, which it hands over to.
if [[ -t 1 && "${TERM:-}" != dumb && -z "${NO_COLOR:-}" ]]; then
  B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; R=$'\e[31m'; C=$'\e[36m'; M=$'\e[35m'; N=$'\e[0m'; BADGE=$'\e[1;30;46m'
else B=""; D=""; G=""; R=""; C=""; M=""; N=""; BADGE=""; fi
UTF=0; [[ "${LANG:-}${LC_ALL:-}${LC_CTYPE:-}" == *UTF-8* ]] && UTF=1
if (( UTF )); then BAR="│"; START="┌"; END="└"; DONE="◇"; ERR="■"; FRAMES="◒◐◓◑"
else BAR="|"; START="T"; END="L"; DONE="o"; ERR="x"; FRAMES='-\|/'; fi

fail() { printf '%s%s%s  %s\n%s%s%s\n\n' "$R" "$ERR" "$N" "$*" "$D" "$END" "$N" >&2; exit 1; }
bar() { printf '%s%s%s\n' "$D" "$BAR" "$N"; }
# step "message" command... — a spinner while it runs, then ✓ and how long it took.
step() {
  local message="$1"; shift
  local log; log="$(mktemp)"; local started=$SECONDS
  "$@" >"$log" 2>&1 &
  local pid=$! i=0
  if [[ -t 1 ]]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r\e[K%s%s%s  %s %s%ss%s' "$M" "${FRAMES:i++%${#FRAMES}:1}" "$N" "$message" "$D" "$((SECONDS - started))" "$N"
      sleep 0.12
    done
    printf '\r\e[K'
  fi
  if wait "$pid"; then
    printf '%s%s%s  %s %s%ss%s\n' "$G" "$DONE" "$N" "$message" "$D" "$((SECONDS - started))" "$N"; rm -f "$log"
  else
    printf '%s%s%s  %s\n' "$R" "$ERR" "$N" "$message"; sed "s/^/${D}${BAR}${N}    /" "$log" | tail -20 >&2; rm -f "$log"
    printf '%s%s%s\n\n' "$D" "$END" "$N"; exit 1
  fi
}

for tool in curl tar; do command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."; done
case "$(uname -s)" in
  Linux) os=linux ;; Darwin) os=darwin ;;
  *) fail "Conduit runs on Linux and macOS. On Windows, run this inside WSL." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;;
  *) fail "No Conduit build for $(uname -m)." ;;
esac
platform="$os-$arch"

if (( ! UPDATE )); then
  printf '\n%s%s%s  %s conduit-server %s  %sinstall%s%s\n' "$D" "$START" "$N" "$BADGE" "$N" "$B" "$N" "${PROFILE:+  ${D}$PROFILE · its own data, port and service${N}}"
  bar
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [[ -n "${CONDUIT_TARBALL:-}" ]]; then
  step "Using $(basename "$CONDUIT_TARBALL")" cp "$CONDUIT_TARBALL" "$work/conduit.tar.gz"
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
    curl -fsSL "$base/$asset.sig" -o "$work/conduit.sig"
    local expected actual
    expected="$(awk '{print $1}' "$work/conduit.sha256")"
    actual="$( (sha256sum "$work/conduit.tar.gz" 2>/dev/null || shasum -a 256 "$work/conduit.tar.gz") | awk '{print $1}')"
    [[ "$expected" == "$actual" ]] || { echo "Checksum mismatch for $asset"; return 1; }
  }
  step "Conduit $VERSION ${D}$platform${N}" fetch_release
fi

mkdir -p "$work/release"
tar -xzf "$work/conduit.tar.gz" -C "$work/release" --strip-components=1
release_version="$(cat "$work/release/VERSION")"
node_version="$(cat "$work/release/NODE_VERSION")"

node_dir="$APP_HOME/node/$node_version"
fetch_node() {
  curl -fsSL "https://nodejs.org/dist/$node_version/node-$node_version-$os-$arch.tar.gz" -o "$work/node.tar.gz"
  mkdir -p "$node_dir"; tar -xzf "$work/node.tar.gz" -C "$node_dir" --strip-components=1
}
if [[ -x "$node_dir/bin/node" ]]; then step "Node $node_version ${D}cached${N}" true
else step "Node $node_version" fetch_node; fi

# Checked with the downloaded Node by a verifier carried in this script, not
# one from the archive it is checking.
verify_signature() {
  cat >"$work/verify.mjs" <<'VERIFY'
// Checks a release archive against its minisign signature (the .sig the Tauri
// signer writes: base64 of a minisign signature file) with Node alone, so
// install.sh needs no minisign on the machine. The key is the Windows
// updater's; one key signs every artifact a release ships.
//   node verify-release.mjs <file> <file.sig> <public key, base64 as in .key.pub>
import crypto from "node:crypto";
import fs from "node:fs";

const [file, sigFile, publicKey] = process.argv.slice(2);
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const keyLine = lines(Buffer.from(publicKey, "base64").toString())[1];
const key = Buffer.from(keyLine, "base64");
const sigText = lines(Buffer.from(fs.readFileSync(sigFile, "utf8").trim(), "base64").toString());
const signature = Buffer.from(sigText[1], "base64");
const trusted = sigText[2].replace(/^trusted comment: /, "");
const globalSignature = Buffer.from(sigText[3], "base64");

const fail = (message) => { console.error(message); process.exit(1); };
if (key.subarray(0, 2).toString() !== "Ed") fail("Unexpected public key type");
if (!signature.subarray(2, 10).equals(key.subarray(2, 10))) fail("Signed by a different key");
const ed25519 = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10, 42)]),
  format: "der", type: "spki",
});
const algorithm = signature.subarray(0, 2).toString();
const message = algorithm === "ED"
  ? crypto.createHash("blake2b512").update(fs.readFileSync(file)).digest()
  : fs.readFileSync(file);
if (!crypto.verify(null, message, ed25519, signature.subarray(10, 74))) fail("Signature does not match");
if (!crypto.verify(null, Buffer.concat([signature.subarray(10, 74), Buffer.from(trusted)]), ed25519, globalSignature)) {
  fail("Trusted comment does not match");
}
VERIFY
  "$node_dir/bin/node" "$work/verify.mjs" "$work/conduit.tar.gz" "$work/conduit.sig" "$SIGNING_KEY"
}
if [[ -z "${CONDUIT_TARBALL:-}" ]]; then step "Signature ${D}release key${N}" verify_signature
elif [[ -f "${CONDUIT_TARBALL}.sig" ]]; then cp "${CONDUIT_TARBALL}.sig" "$work/conduit.sig"; step "Signature ${D}release key${N}" verify_signature; fi

install_release() {
  mkdir -p "$APP_HOME/versions" "$BIN_DIR"
  rm -rf "$APP_HOME/versions/$release_version"
  mv "$work/release" "$APP_HOME/versions/$release_version"
  # A daemon running a development clone keeps running it: the release is
  # added beside it, for `conduit-server use release`.
  if [[ -L "$APP_HOME/current" && ! -f "$APP_HOME/current/NODE_VERSION" ]]; then return; fi
  ln -sfn "$APP_HOME/versions/$release_version" "$APP_HOME/current"
  CONDUIT_PROFILE="$PROFILE" "$APP_HOME/current/scripts/conduit-server" _link
  # Keep the two newest releases, for `conduit-server rollback`.
  ls -1t "$APP_HOME/versions" | tail -n +3 | while read -r old; do rm -rf "${APP_HOME:?}/versions/$old"; done
}
step "Installed in ${D}${APP_HOME/#$HOME/~}${N}" install_release

if [[ ! -f "$APP_HOME/current/NODE_VERSION" ]]; then
  bar; printf '%s%s%s  The daemon keeps running your clone. Try this release: %s%s use release%s\n\n' "$D" "$END" "$N" "$C" "$NAME" "$N"
  exit 0
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '%s%s  add %s to PATH:%s export PATH="%s:$PATH"\n' "$D" "$BAR" "${BIN_DIR/#$HOME/~}" "$N" "$BIN_DIR" ;;
esac

if (( UPDATE )); then
  step "Python tools" env CONDUIT_PROFILE="$PROFILE" "$BIN_DIR/$NAME" _sync-python
  exec env CONDUIT_PROFILE="$PROFILE" "$BIN_DIR/$NAME" restart
fi
if (( SETUP )) && { : </dev/tty; } 2>/dev/null; then
  exec env CONDUIT_PROFILE="$PROFILE" CONDUIT_RAIL=1 "$BIN_DIR/$NAME" setup
fi
bar; printf '%s%s%s  Finish with %s%s setup%s\n\n' "$D" "$END" "$N" "$C" "$NAME" "$N"
