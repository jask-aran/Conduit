#!/usr/bin/env bash
# A development APK stamped with this tree's dev version, published where the dev server hands out its own builds, so
# a native change reaches a phone as an in-app update. It carries the interface the dev server serves (dist), so a
# fresh install starts current rather than at whenever `cap sync` last ran.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || { echo "No dist/: run .devcontainer/start-conduit.sh restart first" >&2; exit 1; }
npx cap copy android >/dev/null
# The server's precompressed copies: Android's asset merger takes foo.js.gz for a second foo.js.
find android/app/src/main/assets/public \( -name '*.gz' -o -name '*.br' \) -delete
version=$(node --input-type=module -e 'import { buildStamp } from "./src/build-info.js"; console.log(buildStamp().version)')
# Minutes since the epoch: rises with every build, and fits Android's integer for the next four thousand years.
code=$(( $(date +%s) / 60 ))
(cd android && CONDUIT_VERSION_NAME="$version" CONDUIT_VERSION_CODE="$code" ./gradlew -q assembleDebug)
dir="${CONDUIT_DESKTOP_UPDATE_DIR:-}"
if [ -z "$dir" ] && command -v wslpath >/dev/null 2>&1; then
  home=$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')
  dir="$(wslpath -u "$home\\conduit-build\\desktop-target-dev")/release/bundle/nsis"
fi
mkdir -p "$dir"
cp android/app/build/outputs/apk/debug/app-debug.apk "$dir/Conduit Dev_${version}.apk"
echo "Conduit Dev_${version}.apk"
