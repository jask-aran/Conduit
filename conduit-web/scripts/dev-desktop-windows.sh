#!/usr/bin/env bash
# Run the desktop shell against the Vite dev server, with no installer in the
# loop at all.
#
# The web half is served from WSL and the window is a Windows process, so the
# two halves meet over http://localhost:5173 -- Vite already binds 0.0.0.0, and
# WSL forwards that port to the Windows side. Editing the client reloads the
# window; editing Rust rebuilds it in the debug profile, which is much faster
# than a release build.
#
# Nothing here installs anything, so nothing here cares about version numbers:
# reinstalling is only needed to test the installer or the updater.
set -euo pipefail

cd "$(dirname "$0")/.."

windows_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
cargo_tauri="$(wslpath -u "$windows_home")/.cargo/bin/cargo-tauri.exe"
target_dir=${CONDUIT_DESKTOP_TARGET_DIR:-"$windows_home\\conduit-desktop-target"}

if [ ! -x "$cargo_tauri" ]; then
  echo "No cargo-tauri.exe under $windows_home\\.cargo." >&2
  exit 1
fi

stale=$(powershell.exe -NoProfile -Command "(Get-Process cargo-tauri -ErrorAction SilentlyContinue).Id -join ' '" 2>/dev/null | tr -d '\r')
if [ -n "$stale" ]; then
  echo "A Windows build is already running (cargo-tauri.exe PID: $stale)." >&2
  exit 1
fi

# Vite belongs to this script, so closing the window takes the server with it.
npm run dev &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT

until curl -sf -o /dev/null http://127.0.0.1:5173; do
  if ! kill -0 "$vite_pid" 2>/dev/null; then
    echo "The dev server exited before it was ready." >&2
    exit 1
  fi
  sleep 0.5
done

project=$(wslpath -w "$PWD/src-tauri")
powershell.exe -NoProfile -Command "\$env:CARGO_TARGET_DIR='$target_dir'; Set-Location '$project'; & '$(wslpath -w "$cargo_tauri")' dev --config tauri.wsl-dev.conf.json ${*:-}"
