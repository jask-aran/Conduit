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

npm run build

project=$(wslpath -w "$PWD/src-tauri")
powershell.exe -NoProfile -Command "\$env:CARGO_TARGET_DIR='$target_dir'; \$env:TAURI_SIGNING_PRIVATE_KEY='$signing_key'; \$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD='${CONDUIT_UPDATER_KEY_PASSWORD:-}'; Set-Location '$project'; & '$(wslpath -w "$cargo_tauri")' build --config tauri.prebuilt.conf.json ${*:-}"

echo
echo "Installer:"
ls -1 "$(wslpath -u "$target_dir")"/release/bundle/nsis/*.exe 2>/dev/null || echo "  none produced" >&2
