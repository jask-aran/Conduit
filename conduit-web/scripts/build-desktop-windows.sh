#!/usr/bin/env bash
# Build the Windows desktop client from inside WSL.
#
# The shell targets WebView2 and links with MSVC, neither of which exists on the
# Linux side, so the Rust half is built by the Windows toolchain reaching into
# this working tree over \\wsl.localhost. The web half is built here, by the
# same `npm run build` every other target uses, and Tauri is told not to run it
# again -- `tauri.prebuilt.conf.json` is that instruction and nothing else.
#
# Cargo's target directory lives on the Windows filesystem. Left in the working
# tree it would write every object file across the 9p share, which turns a
# five-minute build into a much longer one.
#
# Two options exist for testing the update path without cutting a release:
#
#   --version X.Y.Z   build as that version, so an installed copy has something
#                     newer to find
#   --local-updates   point this build's updater at the Conduit server running
#                     on this machine instead of at GitHub
#   --dev             build a separate application -- its own name, identifier,
#                     install directory, settings, token and tray entry -- so it
#                     can be installed alongside the released client. Implies
#                     --local-updates, since a development client that updated
#                     itself from GitHub would replace itself with the release.
#
# Together they close the loop locally: build --dev --version 0.7.2, install it,
# then build --dev --version 0.7.3 and press Update app.
set -euo pipefail

cd "$(dirname "$0")/.."

build_version=""
local_updates=""
dev_client=""
passthrough=()
while [ $# -gt 0 ]; do
  case "$1" in
    --version) build_version=${2:-}; shift 2 ;;
    --local-updates) local_updates=1; shift ;;
    --dev) dev_client=1; local_updates=1; shift ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

windows_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
cargo_tauri="$(wslpath -u "$windows_home")/.cargo/bin/cargo-tauri.exe"
# A development build compiles into a directory of its own.
#
# The last step of a build renames `release\conduit-desktop.exe`, and Windows
# refuses to touch an image a process is running from. `npm run desktop:dev:win`
# runs the binary straight out of this tree, so a dev session and an artifact
# build sharing one directory means the build fails with "Access is denied" and
# the only way forward is to close the window somebody is working in.
#
# Separate directories cost one more full compile the first time and a second
# copy of the build output on disk. Both are cheaper than a build that can only
# run when nothing is open.
target_dir=${CONDUIT_DESKTOP_TARGET_DIR:-"$windows_home\\conduit-desktop-target${dev_client:+-dev}"}

if [ ! -x "$cargo_tauri" ]; then
  echo "No cargo-tauri.exe under $windows_home\\.cargo: install Rust and the" >&2
  echo "Tauri CLI on the Windows side, not in WSL." >&2
  exit 1
fi

# The updater artifact is signed here, with a key that never enters the repo:
# the public half is in tauri.conf.json, and an installed client refuses an
# update that the matching private half did not sign.
key_path=${CONDUIT_UPDATER_KEY:-"$HOME/.conduit/conduit-updater.key"}
if [ ! -f "$key_path" ]; then
  echo "No updater signing key at $key_path." >&2
  echo "Generate one with: npx tauri signer generate -w \"$key_path\"" >&2
  echo "It must stay outside the repository, and CI reads it from a secret." >&2
  exit 1
fi
signing_key=$(tr -d '\r\n' < "$key_path")

# The key is encrypted, so signing needs its password too. It sits beside the
# key rather than in the environment, so a shell history or a process listing
# never carries it; CI passes the same value as a second secret.
password_path=${CONDUIT_UPDATER_KEY_PASSWORD_FILE:-"$key_path.password"}
if [ -z "${CONDUIT_UPDATER_KEY_PASSWORD:-}" ] && [ -f "$password_path" ]; then
  CONDUIT_UPDATER_KEY_PASSWORD=$(tr -d '\r\n' < "$password_path")
fi

# A build interrupted from this side leaves the Windows half running: the
# powershell.exe seen here is a shim, so killing it orphans cargo-tauri.exe,
# which keeps the lock on the target directory. A second build then waits on
# that lock forever with no explanation, so refuse to start instead.
stale=$(powershell.exe -NoProfile -Command "(Get-Process cargo-tauri -ErrorAction SilentlyContinue).Id -join ' '" 2>/dev/null | tr -d '\r')
if [ -n "$stale" ]; then
  echo "A Windows build is already running (cargo-tauri.exe PID: $stale)." >&2
  echo "Let it finish, or end it with:" >&2
  echo "  powershell.exe -NoProfile -Command \"Stop-Process -Id $stale -Force\"" >&2
  exit 1
fi

npm run build

# The Windows half is a script file rather than a -Command string so the
# signing key passes through one layer of quoting instead of three.
# What this build overrides, written next to the config it overrides so the
# CLI resolves it the same way. The committed config is never edited: a build
# that failed halfway would otherwise leave the repository claiming a version
# or an endpoint nobody chose.
# A development build names itself, so no version has to be invented and no
# two builds are ever the same version. It is a prerelease of the patch after
# the last tag: below that release when it arrives, above the release it was
# built from, and ordered against other development builds by the timestamp.
# The commit is carried for reading, not for ordering.
if [ -n "$dev_client" ] && [ -z "$build_version" ]; then
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
  next=$(node -p "const p='${last_tag}'.replace(/^v/,'').split('.').map(Number); \`\${p[0]||0}.\${p[1]||0}.\${(p[2]||0)+1}\`")
  build_version="$next-dev.$(date -u +%Y%m%d%H%M%S).$(git rev-parse --short=7 HEAD 2>/dev/null || echo nogit)"
fi

update_base=${CONDUIT_LOCAL_UPDATE_URL:-"http://127.0.0.1:${CONDUIT_PORT:-4310}/desktop-updates"}
overlay="src-tauri/tauri.build-overlay.conf.json"
trap 'rm -f "$overlay"' EXIT
node -e '
  const [out, version, localUpdates, base, dev] = process.argv.slice(1);
  const overlay = { build: { beforeBuildCommand: "" }, bundle: { createUpdaterArtifacts: false } };
  if (version) overlay.version = version;
  if (localUpdates) {
    // The updater refuses a plain-HTTP endpoint outright, which is right for a
    // release and impossible for a loopback one: a server on this machine has
    // no certificate to present. The signature is still checked, so the
    // guarantee that matters is unchanged.
    overlay.plugins = {
      updater: {
        endpoints: [`${base}/latest.json`],
        dangerousInsecureTransportProtocol: true,
      },
    };
  }
  if (dev) {
    // A different identifier is what makes this a second application rather
    // than a second copy of the same one: Windows keys the install entry, the
    // per-user data directory, the single-instance lock and the credential
    // entry on it, so all four separate without being listed here.
    const config = JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json", "utf8"));
    overlay.productName = "Conduit Dev";
    overlay.identifier = `${config.identifier}.dev`;
    // The executable is named too. Two installs whose binaries share a name
    // are one running application as far as Windows is concerned: the
    // installer asks to close "Conduit" when the other one is running, and
    // both read as the same entry when searched for.
    overlay.mainBinaryName = "conduit-desktop-dev";
    overlay.app = { windows: [{ ...config.app.windows[0], title: "Conduit Dev" }] };
  }
  require("fs").writeFileSync(out, JSON.stringify(overlay, null, 2) + "\n");
' "$overlay" "$build_version" "$local_updates" "$update_base" "$dev_client"

powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$(wslpath -w "$PWD/scripts/build-desktop-windows.ps1")" \
  -Project "$(wslpath -w "$PWD/src-tauri")" \
  -CargoTauri "$(wslpath -w "$cargo_tauri")" \
  -TargetDir "$target_dir" \
  -SigningKey "$signing_key" \
  -SigningKeyPassword "${CONDUIT_UPDATER_KEY_PASSWORD:-}" \
  -ConfigFile "$(basename "$overlay")" \
  ${passthrough[@]+"${passthrough[@]}"}

bundle=$(wslpath -u "$target_dir")/release/bundle/nsis
installer=$(ls -1t "$bundle"/*.exe 2>/dev/null | head -1)
if [ -z "$installer" ]; then
  echo "No installer produced." >&2
  exit 1
fi

# The updater artifact is built and signed here rather than by the Windows CLI.
# A key with an empty password cannot say so through the Windows environment --
# assigning '' to a variable deletes it -- so the CLI finds no password and
# stops to prompt on a console nothing is reading, after the installer is
# already written. The archive is only the installer zipped, and the signature
# is the same minisign signature the CLI would have produced, so doing both on
# this side is the same artifact without the dead end.
archive="${installer%.exe}.nsis.zip"
rm -f "$archive" "$archive.sig"
# Stored, not compressed: the updater reads the zip crate's Stored method only.
(cd "$bundle" && zip -q -0 -j "$(basename "$archive")" "$(basename "$installer")")
node scripts/check-updater-archive.mjs "$archive"
version=${build_version:-$(node -p "require('./src-tauri/tauri.conf.json').version")}
npx tauri signer sign \
  --private-key-path "$key_path" \
  --password "${CONDUIT_UPDATER_KEY_PASSWORD:-}" \
  --app-version "$version" \
  "$archive" > /dev/null

# The manifest, written by the same script the release workflow uses. The URL
# points at the tag rather than at `latest` so a manifest always names the build
# it was signed against.
tag=${CONDUIT_RELEASE_TAG:-"v$version"}
base=${CONDUIT_UPDATER_BASE_URL:-"https://github.com/jask-aran/Conduit/releases/download/$tag"}
# The manifest has to name the same place the build was told to look.
if [ -n "$local_updates" ]; then base=$update_base; fi
node scripts/desktop-update-manifest.mjs \
  "$version" "$base/$(basename "$archive")" "$archive.sig" "$bundle/latest.json" > /dev/null

echo
echo "Bundle ($bundle):"
# An update needs all three: the installer a person runs, the archive the
# updater downloads, and the signature it checks before running anything.
ls -1 "$bundle"/*.exe "$bundle"/*.nsis.zip "$bundle"/*.sig "$bundle"/latest.json 2>/dev/null || echo "  nothing produced" >&2
