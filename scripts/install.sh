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
if (( UTF )); then FILL="━"; EMPTY="─"; else FILL="#"; EMPTY="-"; fi
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

# download "label" url file — a progress bar while it arrives, then ◇ with
# its size and time. Falls back to step's spinner when the size is unknown.
human() { awk -v b="$1" 'BEGIN { if (b >= 1048576) printf "%.1f MB", b / 1048576; else printf "%d kB", b / 1024 }'; }
download() {
  local label="$1" url="$2" out="$3" started=$SECONDS total size pid width=24
  total="$( { curl -fsSLI "$url" 2>/dev/null || true; } | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
  if [[ ! -t 1 || "$total" -le 0 ]]; then step "$label" curl -fsSL "$url" -o "$out"; return; fi
  curl -fsSL "$url" -o "$out" 2>"$work/curl.err" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    size="$( { wc -c <"$out"; } 2>/dev/null | tr -d ' ' || true)"; size="${size:-0}"
    local filled=$(( size * width / total )) elapsed=$(( SECONDS - started )) rate=""
    (( filled > width )) && filled=$width
    (( elapsed > 0 )) && rate=" · $(human $(( size / elapsed )))/s"
    local done_part rest_part
    printf -v done_part '%*s' "$filled" ''; printf -v rest_part '%*s' "$((width - filled))" ''
    printf '\r\e[K%s%s%s  %s  %s%s%s%s%s  %s%d%% %s / %s%s%s' "$M" "${FRAMES:SECONDS%${#FRAMES}:1}" "$N" "$label" \
      "$C" "${done_part// /$FILL}" "$D" "${rest_part// /$EMPTY}" "$N" \
      "$D" $(( size * 100 / total )) "$(human "$size")" "$(human "$total")" "$rate" "$N"
    sleep 0.15
  done
  printf '\r\e[K'
  if wait "$pid"; then printf '%s%s%s  %s %s%s · %ss%s\n' "$G" "$DONE" "$N" "$label" "$D" "$(human "$total")" "$((SECONDS - started))" "$N"
  else printf '%s%s%s  %s\n' "$R" "$ERR" "$N" "$label"; sed "s/^/${D}${BAR}${N}    /" "$work/curl.err" >&2; printf '%s%s%s\n\n' "$D" "$END" "$N"; exit 1; fi
}
ver_ge() { [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" == "$2" ]]; }
choose() { # choose "Question" "one" "two" -> REPLY (1-based); digits then enter
  local q="$1"; shift; local i=1
  printf '%s◆%s  %s\n' "$C" "$N" "$q" >/dev/tty
  for option in "$@"; do printf '%s%s%s  %s%d%s %s\n' "$C" "$BAR" "$N" "$B" "$i" "$N" "$option" >/dev/tty; i=$((i + 1)); done
  printf '%s%s%s  › ' "$C" "$END" "$N" >/dev/tty
  read -r REPLY </dev/tty || REPLY=1
  [[ "$REPLY" =~ ^[0-9]+$ && "$REPLY" -ge 1 && "$REPLY" -le $# ]] || REPLY=1
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
  printf '\n%s%s%s  %s conduit-server %s  %sinstall%s%s\n' "$D" "$START" "$N" "$BADGE" "$N" "$B" "$N" "${PROFILE:+  ${D}$PROFILE${N}}"
  bar
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [[ -n "${CONDUIT_TARBALL:-}" ]]; then
  cp "$CONDUIT_TARBALL" "$work/conduit.tar.gz"
  printf '%s%s%s  Conduit %slocal build · %s%s\n' "$G" "$DONE" "$N" "$D" "$(human "$(wc -c <"$work/conduit.tar.gz")")" "$N"
else
  if [[ -z "$VERSION" ]]; then
    VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest" | sed 's#.*/tag/##')"
    [[ "$VERSION" == v* ]] || fail "Could not find the latest Conduit release."
  fi
  asset="conduit-server-$VERSION-$platform.tar.gz"
  base="${CONDUIT_RELEASE_URL:-https://github.com/$REPOSITORY/releases/download/$VERSION}"
  # The checksum and signature are small; they come alongside.
  curl -fsSL "$base/$asset.sha256" -o "$work/conduit.sha256" 2>/dev/null &
  curl -fsSL "$base/$asset.sig" -o "$work/conduit.sig" 2>/dev/null &
  download "Conduit $VERSION ${D}$platform${N}" "$base/$asset" "$work/conduit.tar.gz"
  wait
  check_sum() {
    local expected actual
    expected="$(awk '{print $1}' "$work/conduit.sha256")"
    actual="$( (sha256sum "$work/conduit.tar.gz" 2>/dev/null || shasum -a 256 "$work/conduit.tar.gz") | awk '{print $1}')"
    [[ "$expected" == "$actual" ]] || { echo "Checksum mismatch for $asset"; return 1; }
  }
  check_sum >"$work/sum.err" 2>&1 || fail "$(cat "$work/sum.err")"
fi

mkdir -p "$work/release"
tar -xzf "$work/conduit.tar.gz" -C "$work/release" --strip-components=1
release_version="$(cat "$work/release/VERSION")"
node_version="$(cat "$work/release/NODE_VERSION")"

node_min="$(cat "$work/release/NODE_MIN" 2>/dev/null || echo 22.19.0)"

# Node: the one on PATH when it is new enough, otherwise a private copy of the
# version the release was built with (asked first when an older one is there).
node_dir="$APP_HOME/node/$node_version"
NODE_BIN=""
system_node="$(command -v node 2>/dev/null || true)"
system_version="$([[ -n "$system_node" ]] && "$system_node" --version 2>/dev/null | sed 's/^v//')"
if [[ -n "$system_version" ]] && ver_ge "$system_version" "$node_min"; then
  NODE_BIN="$system_node"
  printf '%s%s%s  Node v%s %s· yours%s\n' "$G" "$DONE" "$N" "$system_version" "$D" "$N"
elif [[ -x "$node_dir/bin/node" ]]; then
  NODE_BIN="$node_dir/bin/node"
  printf '%s%s%s  Node %s %s· private copy%s\n' "$G" "$DONE" "$N" "$node_version" "$D" "$N"
else
  if [[ -n "$system_version" ]] && { : </dev/tty; } 2>/dev/null; then
    choose "Node v$system_version is older than Conduit needs (v$node_min or newer)" \
      "Download Node $node_version just for Conduit ${D}— leaves yours alone${N}" \
      "Stop; I'll update Node and run this again"
    [[ "$REPLY" == 2 ]] && { bar; printf '%s%s%s  Update Node to v%s or newer, then run the installer again.\n\n' "$D" "$END" "$N" "$node_min"; exit 0; }
  fi
  download "Node $node_version ${D}private copy${N}" "https://nodejs.org/dist/$node_version/node-$node_version-$os-$arch.tar.gz" "$work/node.tar.gz"
  mkdir -p "$node_dir"; tar -xzf "$work/node.tar.gz" -C "$node_dir" --strip-components=1
  NODE_BIN="$node_dir/bin/node"
fi

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
  "$NODE_BIN" "$work/verify.mjs" "$work/conduit.tar.gz" "$work/conduit.sig" "$SIGNING_KEY"
}
# Quiet when it passes; the installer stops with the reason when it does not.
[[ -n "${CONDUIT_TARBALL:-}" && -f "${CONDUIT_TARBALL}.sig" ]] && cp "${CONDUIT_TARBALL}.sig" "$work/conduit.sig"
if [[ -f "$work/conduit.sig" ]]; then verify_signature >"$work/sig.err" 2>&1 || fail "The release signature did not verify: $(cat "$work/sig.err")"
elif [[ -z "${CONDUIT_TARBALL:-}" ]]; then fail "The release has no signature."; fi

# A thin release carries no node_modules: its dependencies come from npm,
# for this machine only (scripts/release-deps.mjs), after the signature check.
thin=0; [[ -d "$work/release/conduit-web/node_modules" ]] || thin=1
# An older conduit-server finds Node only at node/<version>; point that at the
# chosen one so a release from before NODE_BIN still starts.
if [[ ! -x "$node_dir/bin/node" ]]; then mkdir -p "$node_dir/bin"; ln -sfn "$NODE_BIN" "$node_dir/bin/node"; fi

install_release() {
  mkdir -p "$APP_HOME/versions" "$BIN_DIR"
  rm -rf "$APP_HOME/versions/$release_version"
  mv "$work/release" "$APP_HOME/versions/$release_version"
  printf '%s\n' "$NODE_BIN" >"$APP_HOME/versions/$release_version/NODE_BIN"
  # A daemon running a development clone keeps running it: the release is
  # added beside it, for `conduit-server use release`.
  if [[ -L "$APP_HOME/current" && ! -f "$APP_HOME/current/NODE_VERSION" ]]; then return; fi
  ln -sfn "$APP_HOME/versions/$release_version" "$APP_HOME/current"
  CONDUIT_PROFILE="$PROFILE" "$APP_HOME/current/scripts/conduit-server" _link
  # Keep the two newest releases, for `conduit-server rollback`.
  ls -1t "$APP_HOME/versions" | tail -n +3 | while read -r old; do rm -rf "${APP_HOME:?}/versions/$old"; done
}
install_release >/dev/null
dest="$APP_HOME/versions/$release_version"
# Going on to setup, the dependencies install in the background while its
# questions are asked (conduit-server waits on .deps-pending before starting);
# otherwise here and now.
interactive=0; (( SETUP )) && { : </dev/tty; } 2>/dev/null && [[ -f "$APP_HOME/current/NODE_VERSION" ]] && interactive=1
if (( thin )); then
  if (( interactive )); then
    touch "$dest/.deps-pending"
    nohup bash -c '"$1" "$2/scripts/release-deps.mjs" "$2/conduit-web" >"$2/.deps-log" 2>&1 || cp "$2/.deps-log" "$2/.deps-failed"; rm -f "$2/.deps-pending"' _ "$NODE_BIN" "$dest" >/dev/null 2>&1 &
  else
    step "Dependencies" "$NODE_BIN" "$dest/scripts/release-deps.mjs" "$dest/conduit-web"
  fi
fi

# Beside a development clone: the daemon keeps serving the clone unless asked
# to switch; `conduit-server use release|dev` moves between them later.
if [[ ! -f "$APP_HOME/current/NODE_VERSION" ]]; then
  clone="$(readlink -f "$APP_HOME/current")"
  if (( ! UPDATE )) && { : </dev/tty; } 2>/dev/null; then
    bar
    printf '%s?%s  Serve %s now, instead of %s? %s[y/N]%s ' "$C" "$N" "$release_version" "${clone/#$HOME/~}" "$D" "$N" >/dev/tty
    read -r answer </dev/tty || answer=n
    if [[ "$answer" =~ ^[Yy] ]]; then
      exec env CONDUIT_PROFILE="$PROFILE" CONDUIT_RAIL=1 "$APP_HOME/versions/$release_version/scripts/conduit-server" use "$release_version"
    fi
  fi
  bar; printf '%s%s%s  Still serving %s. Switch any time: %s%s use release%s · %suse dev %s%s\n\n' "$D" "$END" "$N" "${clone/#$HOME/~}" "$C" "$NAME" "$N" "$C" "${clone/#$HOME/~}" "$N"
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
