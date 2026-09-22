# Desktop and installed clients

How the Windows desktop client is built, released and updated, and how a
development client runs beside the released one. The Android client shares the
same web half and most of the same rules, so it appears here wherever it
differs.

This replaces `tauri-desktop-plan.md`, which described work that is now done.

## What an installed client is

One Vite build of the same client the browser runs, compiled into a shell:

- **Windows** — a Tauri 2 shell in `conduit-web/src-tauri/`. The web assets are
  compiled into the binary by `generate_context!()`.
- **Android** — a Capacitor shell in `conduit-web/android/`, with the web
  assets copied in by `cap sync`.

Neither loads its interface from the server. **A change to the web client
reaches an installed client only in a new shell build**, which is why a release
ships both together and why there is no server-pushed UI update.

What the shell owns, and the browser has no equivalent for:

| Concern | Browser | Installed client |
| --- | --- | --- |
| Session | cookie, same origin | bearer token in the OS credential store |
| Server address | the origin it was served from | chosen, then stored |
| Sign-in | redirect to `/login` | never redirects; a 401 clears the token |
| Offline assets | service worker | compiled in |

`src/client/platform/installed-client.ts` is the single place that answers
"which client is this" — `installedClientKind` is `browser`, `android` or
`desktop`. Nothing else tests for Capacitor or Tauri.

## Building locally

The shell links against MSVC and targets WebView2, neither of which exists on
the Linux side, so the Rust half is built by the **Windows** toolchain reaching
into the working tree over `\\wsl.localhost`. The web half is built in WSL by
the same `npm run build` every other target uses.

```bash
npm run desktop:build:win                 # release-shaped build
npm run desktop:build:win -- --dev        # a separate development client
npm run desktop:build:win -- --version 0.7.5 --local-updates
```

Output: `C:\Users\<you>\conduit-desktop-target\release\bundle\nsis\` — the
installer, the updater archive, its signature and `latest.json`.

Cargo's target directory is on `C:` deliberately; left in the tree it writes
every object file across the 9p share.

Options, all of which write to a temporary overlay config rather than editing
`tauri.conf.json`, so a build that fails halfway leaves nothing behind:

- `--version X.Y.Z` — build as that version.
- `--local-updates` — point this build's updater at the Conduit server on this
  machine instead of at GitHub.
- `--dev` — build a **separate application**, and imply `--local-updates`. It
  compiles into `conduit-desktop-target-dev\` rather than the shared tree,
  because the last step of a build renames the binary and Windows refuses to
  touch an image a process is running from — so a `desktop:dev:win` session and
  an artifact build sharing one directory means the build fails until the
  window somebody is working in is closed. `start-conduit.sh` prefers this
  directory when serving updates.

The script refuses to start while another `cargo-tauri.exe` is alive. An
interrupted build orphans the Windows process — `powershell.exe` under WSL is a
shim, so killing it from here leaves the real build holding the target lock —
and the next build would otherwise wait on that lock with no explanation.

### Iterating without building an installer

```bash
npm run desktop:dev:win
```

Runs the shell against the Vite dev server: the window is a Windows process,
the web half is served from WSL, and they meet on the port Vite already
exposes. The client reloads on save; Rust rebuilds in the debug profile.
Nothing is installed, so no version is compared and none has to be invented.

## The development client

`--dev` produces an application that installs beside the released one:

| | Released | Development |
| --- | --- | --- |
| Name | Conduit | Conduit Dev |
| Identifier | `com.jaskaran.conduit.desktop` | `…​.desktop.dev` |
| Version | the release's | `0.7.2-dev.<timestamp>.<commit>` |
| Updates from | GitHub releases | `http://127.0.0.1:4310/desktop-updates` |

The identifier is what does the work. Windows keys the install entry, the
per-user data directory, the single-instance lock and the credential entry on
it, so settings, webview storage, the lock and the token all separate without
being arranged separately. The token is stored under the running build's
identifier for exactly this reason: under a constant name, signing out of one
client would sign out the other.

The **executable name is a separate axis**, and `--dev` sets `mainBinaryName` too. NSIS looks
for a running instance by binary name, so two installs shipping
`conduit-desktop.exe` are one application as far as Windows is concerned:
installing the development client asks to close "Conduit", and Windows search
offers two entries that read the same.

A development client points its updater at a loopback address, which the
updater refuses outright unless `dangerousInsecureTransportProtocol` is set —
right for a release and impossible for a server on this machine, which has no
certificate to present. Without it the client panics before its first window.
The allowance relaxes the transport only; the signature is still checked
against the key compiled into the build, which is what makes an update safe.

**A development build names its own version**: the patch after the last tag, as
a prerelease carrying the build time and the commit. It sorts above the release
it was built from, below the release it anticipates — so a real release always
wins — and above the development build before it. Nothing has to be chosen by
hand for an update to have an answer.

Both clients claim the same global shortcuts by default. Whichever starts
second reports the refused chord and keeps working; rebind it in that client's
settings, which are its own.

## The Android development APK

`npm run android:build` writes
`conduit-web/android/app/build/outputs/apk/debug/app-debug.apk`. It follows the
same "beside, not over" rule as the Windows development client, by the same
mechanism:

| | Released | Development |
| --- | --- | --- |
| Built by | CI, on a tag | `npm run android:build`, locally |
| Identifier | `com.jaskaran.conduit` | `com.jaskaran.conduit.dev` |
| Signed with | the persistent release keystore | the local debug key |
| Version | the tag's | `0.0.0-dev` |
| Updates from | GitHub releases | nothing |

The suffix comes from `applicationIdSuffix ".dev"` on the debug build type, so
the two installs keep separate storage, separate tokens and separate entries in
the launcher.

**It has no update path.** The version it reports is below every release, so
Check for updates always finds the latest release newer — and because the
identifiers differ, taking that offer installs the *released* app beside the
development one rather than updating it. To move a development build forward,
build and sideload again.

**The signing keys are why a development APK can never become a release.**
Android refuses an update signed with a different key, and only CI holds the
release keystore (`ANDROID_KEYSTORE_BASE64` and friends). A release candidate
is a CI artifact from a tag; a local APK is for looking at, not for shipping.

## Updating

### Desktop

The updater fetches a manifest, verifies a **minisign signature** against the
public key compiled into the build, installs silently and relaunches. Conduit
reports its own download and install progress, so the update is one line in one
window.

Three things must agree or an update is invisible: the version compiled into
the binary, the version in the manifest, and the release the artifacts sit in.

The settings and the token survive an update because they live in the
credential store and the webview's own storage, not in the binary.

### Android

A new APK replaces the shell, which a service worker cannot do. Check for
updates asks the GitHub releases API for the latest tag, compares it with the
running version, and hands the APK to the system when it is newer. **Android
confirms before installing anything from outside the Play Store**, and that
prompt cannot be suppressed for a sideloaded APK — it is the last thing between
a download and code running on the phone.

### Testing an update without publishing one

```bash
# 1. a baseline to update from
npm run desktop:build:win -- --dev
#    install "Conduit Dev_<version>_x64-setup.exe"

# 2. the server serves the build directory -- it finds it by itself
bash .devcontainer/start-conduit.sh restart

# 3. something newer, then press Check for updates
npm run desktop:build:win -- --dev
```

`start-conduit.sh` looks for the directory the Windows build writes into and
serves it when it is there, because remembering an environment variable before
every restart is the difference between testing an update and not bothering.
`CONDUIT_DESKTOP_UPDATE_DIR` still overrides it. `/desktop-updates` exists only
when that names a directory, serves that one directory, and 404s a missing
file. It sits **ahead
of authentication**, because the updater runs in the shell and carries no
session: what makes an update safe to install is the signature the client
checks, not the secrecy of the URL it came from.

## Releasing

A tag runs `validate → {android, container, windows} → release` in
`.github/workflows/publish-container.yml`. The release job waits for all three,
so one tag produces artifacts that agree with each other. As for every release,
the tag needs a changelog at `docs/releases/<tag>.md`.

The Windows job writes the tag's version into `tauri.conf.json` before
building, then:

1. builds with updater artifacts **off**;
2. zips the installer with 7-Zip using **Stored**, no compression;
3. signs that archive with the minisign key;
4. writes `latest.json` pointing at the tag, not at `latest`;
5. uploads all four to the Release in one command.

Two of those steps are not arbitrary:

- **Stored, not compressed.** `tauri-plugin-updater` depends on the `zip` crate
  with default features off, so Stored is the only method it can read. A
  deflated archive downloads, verifies and then fails to install.
  `scripts/check-updater-archive.mjs` enforces this before signing, because the
  reader only refuses the archive after downloading all of it.
- **Signed separately from the build.** The Tauri CLI signs during bundling and
  asks for the key's password when it cannot find one in the environment.
  Windows cannot hold an environment variable set to the empty string —
  assigning `''` deletes it — so a key with an empty password cannot say so,
  and the CLI stops to prompt on a console nothing is reading.

### Keys and secrets

| | Where |
| --- | --- |
| Updater private key | `~/.conduit/conduit-updater.key`, encrypted |
| Its password | `~/.conduit/conduit-updater.key.password` |
| Public half | `src-tauri/tauri.conf.json`, compiled into every build |
| CI | `CONDUIT_UPDATER_KEY`, `CONDUIT_UPDATER_KEY_PASSWORD` |

A client only accepts updates signed by the key **its own build** carried, so
replacing the key strands every install that is already out. Losing the private
key or its password means no installed client can ever be updated again.

## Talking to more than one server

An installed client holds a list of servers and a token for each, switches by
remounting rather than reloading, and shares the list with other clients
through the servers themselves. It also does two things no browser can: it
browses the local network for servers over mDNS, and it can move between them
without navigating. That model is the same for the browser except for how a
switch happens, so it is documented once in [`servers.md`](servers.md) rather
than here.

## Which build am I running

Settings → Appearance → **About** names the three things that ship separately:
the interface (release or version, commit, build time), the shell's own version
on an installed client, and the server's release from `/healthz`. It is also
how you see that an update took.

A development build says so in its identity rather than only in its version:
"Conduit Dev" in the launcher on Windows, `com.jaskaran.conduit.dev` on
Android. Both install beside the release, so both can be present at once and
"which one did I just open" is a real question. `docs/testing.md` lists the
four builds side by side.

## Not done

- **Code signing.** The installer is unsigned, so SmartScreen warns on a clean
  machine and the publisher reads as unknown. Independent of the updater, which
  verifies minisign against the compiled-in key.
- **The clean-VM checklist.** Fresh install, upgrade, uninstall, unreachable
  server, expired token, an occupied global shortcut, a corrupt update,
  SmartScreen and WebView2 bootstrap have not been exercised on a machine with
  no Conduit history.
- **macOS and Linux.** The shell is written without Windows-only assumptions
  apart from the caption colouring and the credential backend, both already
  behind `cfg`.
