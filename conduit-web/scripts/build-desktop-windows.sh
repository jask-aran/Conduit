#!/usr/bin/env bash
# Build the Windows desktop client from inside WSL: MSVC and WebView2 exist only on the Windows side, so the Windows
# toolchain builds the Rust half over \\wsl.localhost and the web half is built here.
#
# Cargo's target directory lives on the Windows filesystem: across the 9p share every object file is slow to write.
#
#   --version X.Y.Z   build as that version, so an installed copy has something newer to find
#   --local-updates   point the updater at a Conduit server instead of GitHub
#   --dev             a separate application (own name, identifier, install, settings, token) that installs alongside
#                     the release. Implies --local-updates: updating from GitHub would replace it with the release.
set -euo pipefail

cd "$(dirname "$0")/.."

build_version=""
local_updates=""
dev_client=""
variant="dev"
passthrough=()
while [ $# -gt 0 ]; do
  case "$1" in
    --version) build_version=${2:-}; shift 2 ;;
    --local-updates) local_updates=1; shift ;;
    --dev) dev_client=1; local_updates=1; shift ;;
    --durable) dev_client=1; local_updates=1; variant=durable; shift ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

windows_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
# Build output lives under %LOCALAPPDATA%, which Windows Search leaves out: under the user folder every .exe shows up
# in the Start menu as an app.
build_home=$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')\\conduit-build
cargo_tauri="$(wslpath -u "$windows_home")/.cargo/bin/cargo-tauri.exe"
# A development build compiles into its own directory: the build renames `release\conduit-desktop.exe`, Windows
# refuses that while `npm run desktop:dev:win` runs the binary from the tree, and the build fails "Access is denied".
target_dir=${CONDUIT_DESKTOP_TARGET_DIR:-"$build_home\\desktop-target${dev_client:+-$variant}"}

if [ ! -x "$cargo_tauri" ]; then
  echo "No cargo-tauri.exe under $windows_home\\.cargo: install Rust and the" >&2
  echo "Tauri CLI on the Windows side, not in WSL." >&2
  exit 1
fi

# The signing key never enters the repo: an installed client refuses an update the private half did not sign.
key_path=${CONDUIT_UPDATER_KEY:-"$HOME/.conduit/conduit-updater.key"}
if [ ! -f "$key_path" ]; then
  echo "No updater signing key at $key_path." >&2
  echo "Generate one with: npx tauri signer generate -w \"$key_path\"" >&2
  echo "It must stay outside the repository, and CI reads it from a secret." >&2
  exit 1
fi
signing_key=$(tr -d '\r\n' < "$key_path")

# The password sits beside the key, not in the environment, so no shell history or process listing carries it.
password_path=${CONDUIT_UPDATER_KEY_PASSWORD_FILE:-"$key_path.password"}
if [ -z "${CONDUIT_UPDATER_KEY_PASSWORD:-}" ] && [ -f "$password_path" ]; then
  CONDUIT_UPDATER_KEY_PASSWORD=$(tr -d '\r\n' < "$password_path")
fi

# powershell.exe here is a shim: killing it orphans cargo-tauri.exe, which holds the target directory's lock, and the
# next build waits on that lock forever.
stale=$(powershell.exe -NoProfile -Command "(Get-Process cargo-tauri -ErrorAction SilentlyContinue).Id -join ' '" 2>/dev/null | tr -d '\r')
if [ -n "$stale" ]; then
  echo "A Windows build is already running (cargo-tauri.exe PID: $stale)." >&2
  echo "Let it finish, or end it with:" >&2
  echo "  powershell.exe -NoProfile -Command \"Stop-Process -Id $stale -Force\"" >&2
  exit 1
fi

if [ -n "$dev_client" ] && [ -z "$build_version" ]; then
  build_version=$(CONDUIT_RELEASE_TAG= GITHUB_REF_TYPE= node --input-type=module -e 'import { buildStamp } from "./src/build-info.js"; console.log(buildStamp().version)')
fi

if [ -n "$dev_client" ]; then
  CONDUIT_RELEASE_TAG= GITHUB_REF_TYPE= CONDUIT_BUILD_VERSION="$build_version" npm run build
elif [ -n "$build_version" ]; then
  CONDUIT_RELEASE_TAG="v${build_version#v}" CONDUIT_BUILD_VERSION="$build_version" npm run build
else
  npm run build
fi

if [ -n "$dev_client" ]; then
  default_base="https://conduit-local.jask-aran.com/desktop-updates"
  [ "$variant" = durable ] && default_base="https://conduit-durable.jask-aran.com/desktop-updates"
  update_base=${CONDUIT_LOCAL_UPDATE_URL:-"$default_base"}
else
  update_base=${CONDUIT_LOCAL_UPDATE_URL:-"http://127.0.0.1:${CONDUIT_PORT:-4310}/desktop-updates"}
fi
windows_node=$(cmd.exe /c 'where node' 2>/dev/null | tr -d '\r' | head -n 1)
if [ -z "$windows_node" ]; then
  echo "No node.exe on the Windows side: the desktop app ships it to run its device companion." >&2
  exit 1
fi
node ../scripts/build-node-companion.mjs "$(wslpath -u "$windows_node")" --platform win32 --arch x64

overlay="src-tauri/tauri.build-overlay.conf.json"
trap 'rm -f "$overlay"' EXIT
node -e '
  const [out, version, localUpdates, base, dev, variant] = process.argv.slice(1);
  const overlay = { build: { beforeBuildCommand: "" },
    bundle: { createUpdaterArtifacts: false, resources: { "companion/": "companion/" } } };
  if (version) overlay.version = version;
  if (localUpdates) {
    // The updater refuses a plain-HTTP endpoint outright, which is right for a
    // release and impossible for a loopback one: a server on this machine has
    // no certificate to present. A development client can select a local
    // server route at runtime even when its fallback endpoint uses HTTPS.
    // The signature is still checked before any update is installed.
    overlay.plugins = {
      updater: {
        endpoints: [`${base}/latest.json`],
        ...((dev || base.startsWith("http://")) ? { dangerousInsecureTransportProtocol: true } : {}),
      },
    };
  }
  if (dev) {
    // A different identifier is what makes this a second application rather
    // than a second copy of the same one: Windows keys the install entry, the
    // per-user data directory, the single-instance lock and the credential
    // entry on it, so all four separate without being listed here.
    const config = JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const title = variant === "durable" ? "Durable" : "Dev";
    overlay.productName = `Conduit ${title}`;
    overlay.identifier = `${config.identifier}.${variant}`;
    // The executable is named too. Two installs whose binaries share a name
    // are one running application as far as Windows is concerned: the
    // installer asks to close "Conduit" when the other one is running, and
    // both read as the same entry when searched for.
    overlay.mainBinaryName = `conduit-desktop-${variant}`;
    overlay.bundle.icon = config.bundle.icon.map((icon) => icon.replace("icons/", "icons/dev/"));
    overlay.bundle.windows = { nsis: { installerIcon: "icons/dev/icon.ico" } };
    // A development client keeps its DevTools port open, so it can be inspected and driven over CDP without being
    // relaunched (Dev 9223, Durable 9224). Setting the arguments replaces the ones wry sets, so those are kept here.
    const port = variant === "durable" ? 9224 : 9223;
    overlay.app = { windows: [{ ...config.app.windows[0], title: "",
      additionalBrowserArgs: `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=${port} --remote-allow-origins=*` }] };
  }
  require("fs").writeFileSync(out, JSON.stringify(overlay, null, 2) + "\n");
'  "$overlay" "$build_version" "$local_updates" "$update_base" "$dev_client" "$variant"

windows_args=()
if [ -n "$dev_client" ]; then windows_args+=(-FastBuild); fi

powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "$(wslpath -w "$PWD/scripts/build-desktop-windows.ps1")" \
  -Project "$(wslpath -w "$PWD/src-tauri")" \
  -CargoTauri "$(wslpath -w "$cargo_tauri")" \
  -TargetDir "$target_dir" \
  -SigningKey "$signing_key" \
  -SigningKeyPassword "${CONDUIT_UPDATER_KEY_PASSWORD:-}" \
  -ConfigFile "$(basename "$overlay")" \
  ${windows_args[@]+"${windows_args[@]}"} \
  ${passthrough[@]+"${passthrough[@]}"}

bundle=$(wslpath -u "$target_dir")/release/bundle/nsis
# sed, not head: head leaves early, and under pipefail a long listing then ends the build with SIGPIPE (141).
installer=$(ls -1t "$bundle"/*.exe 2>/dev/null | sed -n 1p)
if [ -z "$installer" ]; then
  echo "No installer produced." >&2
  exit 1
fi

# The updater artifact is signed here, not by the Windows CLI: an empty password cannot pass through the Windows
# environment (assigning '' deletes the variable), so the CLI would prompt on a console nothing reads.
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

# The URL names the tag, not `latest`, so a manifest always names the build it was signed against.
tag=${CONDUIT_RELEASE_TAG:-"v$version"}
base=${CONDUIT_UPDATER_BASE_URL:-"https://github.com/jask-aran/Conduit/releases/download/$tag"}
if [ -n "$local_updates" ]; then base=$update_base; fi
node scripts/desktop-update-manifest.mjs \
  "$version" "$base/$(basename "$archive")" "$archive.sig" "$bundle/latest.json" > /dev/null

echo
echo "Bundle ($bundle):"
ls -1 "$bundle"/*.exe "$bundle"/*.nsis.zip "$bundle"/*.sig "$bundle"/latest.json 2>/dev/null || echo "  nothing produced" >&2
