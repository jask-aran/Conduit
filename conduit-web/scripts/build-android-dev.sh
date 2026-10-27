#!/usr/bin/env bash
# A development APK stamped with this tree's dev version, published where the dev server hands out its own builds
# (CONDUIT_DESKTOP_UPDATE_DIR, as start-conduit.sh finds it). The dev app's updater offers the newest one by that stamp,
# so a native change reaches a phone as an in-app update rather than a side-load. Gradle only: the interface is not
# bundled anew (the dev app takes it live from the server).
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node --input-type=module -e 'import { buildStamp } from "./src/build-info.js"; console.log(buildStamp().version)')
# Minutes since the epoch: rises with every build, and fits Android's integer for the next four thousand years.
code=$(( $(date +%s) / 60 ))
(cd android && CONDUIT_VERSION_NAME="$version" CONDUIT_VERSION_CODE="$code" ./gradlew -q assembleDebug)
dir="${CONDUIT_DESKTOP_UPDATE_DIR:-}"
if [ -z "$dir" ] && command -v wslpath >/dev/null 2>&1; then
  home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
  dir="$(wslpath -u "$home\\conduit-desktop-target-dev")/release/bundle/nsis"
fi
mkdir -p "$dir"
cp android/app/build/outputs/apk/debug/app-debug.apk "$dir/Conduit Dev_${version}.apk"
echo "Conduit Dev_${version}.apk"
