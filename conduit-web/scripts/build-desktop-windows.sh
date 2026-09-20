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
set -euo pipefail

cd "$(dirname "$0")/.."

windows_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
cargo_tauri="$(wslpath -u "$windows_home")/.cargo/bin/cargo-tauri.exe"
target_dir=${CONDUIT_DESKTOP_TARGET_DIR:-"$windows_home\\conduit-desktop-target"}

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
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$(wslpath -w "$PWD/scripts/build-desktop-windows.ps1")" \
  -Project "$(wslpath -w "$PWD/src-tauri")" \
  -CargoTauri "$(wslpath -w "$cargo_tauri")" \
  -TargetDir "$target_dir" \
  -SigningKey "$signing_key" \
  -SigningKeyPassword "${CONDUIT_UPDATER_KEY_PASSWORD:-}" \
  ${*:-}

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
(cd "$bundle" && zip -q -j "$(basename "$archive")" "$(basename "$installer")")
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
npx tauri signer sign \
  --private-key-path "$key_path" \
  --password "${CONDUIT_UPDATER_KEY_PASSWORD:-}" \
  --app-version "$version" \
  "$archive" > /dev/null

# The manifest an installed client reads before it downloads anything. It is
# written beside the artifacts so a release is these four files and nothing
# assembled by hand; the URL points at the tag rather than `latest` so a
# manifest always names the build it was signed against.
tag=${CONDUIT_RELEASE_TAG:-"v$version"}
base=${CONDUIT_UPDATER_BASE_URL:-"https://github.com/jask-aran/Conduit/releases/download/$tag"}
node -e '
  const [version, url, signature, out] = process.argv.slice(1);
  const manifest = {
    version,
    pub_date: new Date().toISOString(),
    platforms: { "windows-x86_64": { signature, url } },
  };
  require("fs").writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
' "$version" "$base/$(basename "$archive")" "$(cat "$archive.sig")" "$bundle/latest.json"

echo
echo "Bundle ($bundle):"
# An update needs all three: the installer a person runs, the archive the
# updater downloads, and the signature it checks before running anything.
ls -1 "$bundle"/*.exe "$bundle"/*.nsis.zip "$bundle"/*.sig "$bundle"/latest.json 2>/dev/null || echo "  nothing produced" >&2
