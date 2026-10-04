# Testing Conduit

Run authenticated and native browser tests against `http://127.0.0.1:4310`.
Run `npm` commands from `conduit-web/`.

## Verification Tiers & Cost

Always pick the lowest tier that can prove the change. Do not escalate to Tier 3 or Tier 4 during iterative coding turns.

| Tier | Latency | Token Cost | Commands | When to Use |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: Static & Isolated** | < 2s | **Minimal** (clean exit) | `npm run typecheck`<br>`node --test test/<file>.test.js` | Contract changes, types, server routes, isolated logic. |
| **Tier 2: Fast Deterministic Harnesses** | < 1s | **Low** (compact JSON) | `node scripts/run-harness.mjs [--profile ...]`<br>`node scripts/bench-renderer.mjs`<br>`curl` with `conduit-auth.mjs mint-session` | WebSocket lifecycles, streaming backpressure, KaTeX/markdown parser, live server HTTP headers. |
| **Tier 3: Targeted Browser** | 10–30s | **Moderate** | `npm run qa:agent-browser`<br>`npm run agent-browser:local -- --session <id> ...` | Real DOM interactions, focus/keyboard traps, CSS layout regressions. Driven, not asserted. |
| **Tier 3: Panes smoke** | ~1m | **Low** (one line per scenario) | `node --test test/file-tabs.test.js`<br>`npm run smoke:panes [-- --project <name>]` | Panes, file viewer tabs and columns, drag targets and pills, header folding, focus and the dock's place. Asserted; run after any change to them, including performance work. |
| **Tier 4: Broad Sweeps & Canaries** | 30s–5m+ | **Prohibitive** (context poison) | `npm test` | Release verification only. **Do not run during iterative coding turns.** |

## Panes smoke

`npm run smoke:panes` drives the panes and file viewer in headless Chromium
against the running server and prints `ok`/`FAIL` per scenario, exiting 1 on
any failure. It is read-only (files are opened, never edited) and each
scenario gets a fresh browser context, so the saved layout starts empty. It
picks the first project with six top-level files; `--project <name>` picks
one, and a project whose page lists files (not Conduit's own) also covers the
project page scenario. Playwright is taken from `conduit-web`'s dependencies
or installed once into `.smoke-tools/`. Run it from the checkout the server
serves: the session it mints goes into that checkout's `data/`. The tab
rules themselves are unit tests in `test/file-tabs.test.js`.

## Local authentication

Mint a session without using the password:

```bash
# repository root
node scripts/conduit-auth.mjs mint-session \
  --user-agent <label> \
  --format <token|cookie|json|playwright> \
  --output /tmp/conduit-auth
```

- `token`: raw session token
- `cookie`: `conduit_session=...` for HTTP or browser cookie import
- `json`: token and session metadata
- `playwright`: browser `storageState` JSON, for any external automation
- Omit `--output` to write to stdout. Output files use mode `0600`.
- Agent Browser and Windows DevTools mint and install their own sessions.

## Browser surfaces

| Surface | Use |
| --- | --- |
| Agent Browser | authenticated navigation, accessibility, screenshots, ordinary UI QA |
| Windows Chrome DevTools | headed native frame, compositor, GPU, paint, layout, console, and network profiling |

### Agent Browser

Initialize or restore an authenticated session:

```bash
curl -fsS http://127.0.0.1:4310/healthz
npm run qa:agent-browser
```

Use the session ID printed by the command:

```bash
npm run agent-browser:local -- --session <id> --restore snapshot -i -c
npm run agent-browser:local -- --session <id> --restore a11y
npm run agent-browser:local -- --session <id> --restore screenshot /tmp/conduit.png
npm run agent-browser:local -- --session <id> close
```

Commands available through `agent-browser:local`:

- Navigate: `open`, `back`, `forward`, `reload`, `wait`
- Inspect: `snapshot`, `read`, `get`, `is`, `find`, `a11y`, `console`, `errors`
- Interact: `click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`, `focus`, `check`, `uncheck`, `select`, `drag`, `scroll`, `scrollintoview`
- Evidence: `screenshot`, `diff snapshot`
- Session: `close`
- Reference: `agent-browser skills get core --full`

### Windows Chrome DevTools

Chrome uses the persistent profile `C:\Users\jaska\AppData\Local\Conduit\chrome-agent` and CDP port `9222`.

```bash
curl -fsS http://127.0.0.1:4310/healthz
node ../scripts/run-windows-chrome-devtools.mjs start
node ../scripts/run-windows-chrome-devtools.mjs cli list_pages
node ../scripts/run-windows-chrome-devtools.mjs cli new_page http://127.0.0.1:4310/
node ../scripts/run-windows-chrome-devtools.mjs cli take_snapshot
node ../scripts/run-windows-chrome-devtools.mjs cli performance_start_trace --autoStop --filePath /tmp/conduit-native.json.gz
node ../scripts/run-windows-chrome-devtools.mjs stop-cli
```

`stop-cli` leaves Chrome and its profile running. Agent Browser is not a native
performance surface.

The local server serves a production build, so the page has a service worker
and can keep serving the previous bundle after a rebuild. Since a new worker
now waits rather than taking over (see the PWA section of
`conduit-web/README.md`), a reload alone is not enough. Anything that measures
a build must clear the worker first, or the numbers describe code that is not
running:

```js
navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
location.reload();
```

Confirm by checking the hashed chunk name in the network log actually changed.

Wrapper and `cli` commands:

- Lifecycle: `status`, `start`, `stop-cli`
- Pages: `list_pages`, `new_page`, `select_page`, `navigate_page`, `close_page`, `resize_page`
- Inspect: `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `get_console_message`, `list_network_requests`, `get_network_request`
- Interact: `click`, `click_at`, `hover`, `drag`, `fill`, `type_text`, `press_key`, `handle_dialog`, `upload_file`
- Performance: `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `lighthouse_audit`
- Memory: `take_heapsnapshot`, `get_heapsnapshot_summary`, `get_heapsnapshot_details`, `compare_heapsnapshots`
- Reference: `chrome-devtools --help` or `chrome-devtools <command> --help`

#### Probes

The instruments behind the sections below are in `conduit-web/scripts/probes/`.
Run them from `conduit-web/` in the checkout the server serves. Each one opens
a page of its own in headless Chromium, with a minted session. With
`--windows`, it uses the headed Windows Chrome on :9222 instead, which is the
only place display scaling and frame cost are real.

| Probe | Answers |
| --- | --- |
| `press-shift.mjs` | Does pressing and holding a resize handle move any formula, table or block, or change a pixel? |
| `reload-settle.mjs --out <dir>` | What moves after the first open's fade starts? Saves a frame series and an attribute and animation timeline. |
| `placeholder-heights.mjs` | Do off-screen blocks hold their real height? |
| `motion-rules.mjs` | Which loaded CSS rules set containment, `will-change`, transforms or `content-visibility`, and which only apply under an interaction state? |
| `dock-layer-frames.mjs` | Does the dock hold still when it switches between beside the panes and over them? |
| `stream-budget.mjs` | While an answer streams: tasks over 6.94ms, what ran inside them, and how evenly the text appeared. It makes a live model call. |

A probe killed mid-run leaves its page open in Windows Chrome. Close it before
the next run, or the next page load can hang.

#### Frame budget

The budget is 6.94ms per task (144Hz), measured from a trace, not from gaps
between animation frames. Use headed Windows Chrome: its CDP port is reachable
from WSL at `http://127.0.0.1:9222`. To trace, drive the logged-in page with
Playwright `chromium.connectOverCDP` and call `Tracing.start` with only the
`devtools.timeline,toplevel` categories; `scripts/probes/stream-budget.mjs --windows` does this for a streamed answer.

Don't use the CLI's `performance_start_trace` for frame numbers on DOM-heavy
work. It turns on invalidation tracking, which records a stack for every DOM
write. On a KaTeX stream it reported ten times the over-budget tasks that a
lean trace found.

For streaming-render faults, replay the Test profile's KaTeX models in the
`test` project. Check every frame for three things: a math element removed, a
math element emptied, or TeX commands in text outside math.

#### Layout stability

Text that shifts and then settles ("sizzle") is measured, not judged by eye.
DESIGN.md (Transcript → Nothing moves once drawn) states the rule. Prefer
finding the structure that changes geometry over adding delays. Each check
below has a probe: `motion-rules`, `press-shift`, `placeholder-heights` and
`reload-settle`.

- **Use headed Windows Chrome at the user's scaling.** At a fractional
  `devicePixelRatio` (1.25, 1.5), anything that gets its own paint or
  compositing layer snaps to whole device pixels: `contain: paint`,
  `will-change`, a transform on a layer. Text that sat between pixels jumps
  when such a rule switches on. Headless WSL at DPR 1 cannot show this.
- **Read the stylesheet before instrumenting.** List the rules that change
  containment, `will-change`, `transform` or `content-visibility` under an
  interaction state such as `[data-panel-motion]`. A rule that only applies
  while a handle is held is the first suspect for a shift on press.
- **Diff screenshots around the interaction.** Use CDP
  `Input.dispatchMouseEvent` to press a handle, hold it and release it, and
  take a screenshot at each step. Zero changed pixels between rest and press is
  the bar.
- **Take every element's rect, not a sample.** Record
  `getBoundingClientRect()` for every `.katex`, table and block before, during
  and after. Only some formulas move, and always the same ones, so a sample can
  miss them.
- **Check placeholders against the real heights.** For "moves on load, then
  settles", compare each off-screen block's `contain-intrinsic-block-size` with
  its height once revealed. A placeholder measured while the block was still
  rendering stays short.

- **Step animations frame by frame.** For a layout switch or pane motion,
  slow the page's animations with CDP `Animation.setPlaybackRate` (0.1–0.2)
  and step the width across the switch in both directions, as a drag does.
  Measure after the layout has changed: a Solid effect holds DOM updates until
  it ends, so measure in a microtask after it, before the frame is painted.

### Paired physical Android phone

The operator's Samsung SM-S936B is paired for wireless ADB as of
2026-10-03. It runs the Android dev client, `com.jaskaran.conduit.dev`,
which installs beside the released app. Device geometry and WebView details
are in **Matching the device** below; check the current WebView version
before using that recorded version as evidence.

Use the Windows Android SDK's `adb.exe` for this pairing. Linux ADB pairing
failed with `error: protocol fault (couldn't read status message): Success`;
Windows ADB paired and connected successfully. WSL's Linux ADB client can
use that Windows server through `ADB_SERVER_SOCKET`. Android CLI did not
find the phone through that server; direct ADB installs worked. Preserve the
working server rather than replacing it to make Android CLI see the phone.

Check `adb devices -l` through the working server before each session. Select
the connected SM-S936B explicitly with `-s`; the same phone can appear under
two connection aliases. Read connection values from the current session.
Keep phone addresses, connection ports, pairing codes and device identifiers
out of this document.

The verified update command, with `PHONE_SERIAL` set from that device list,
is:

```bash
adb -s "$PHONE_SERIAL" install -r ~/conduit-dev.apk
```

This updates Conduit Dev and keeps its app data. Check for `Success`, then
reopen Conduit Dev. The latest successful install of this artifact was on
2026-10-03.

Measured on this connection: five shell commands took 19–40 ms, median
30 ms; a screenshot took 958 ms. Scripted input is fast enough for short
interaction tests. Screen recording runs on the phone; retrieve the video
afterward instead of relying on a live screenshot loop. Recording frame rate
on this phone has not been measured.

Use headless checks for routine menu and focus permutations. Use the phone
for native Back, real keyboard timing, camera scanning and WebView frost
rendering. Pairing and successful installation do not prove those behaviours.

### Android shell on an emulator

A headless AVD driven over ADB, with Chrome DevTools into the Capacitor
WebView. It is the only way to see the Android shell without a round trip
through somebody's phone, and it answers questions about *what arrives* --
events, order, geometry, inset dispatch -- not about how something looks.

    /usr/bin/sg kvm -c "$ANDROID_HOME/emulator/emulator -avd conduit-kbd36 \
      -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot"

`sg` is shadowed by `ast-grep`, hence the absolute path. `hw.keyboard = no` in
`config.ini` forces the soft keyboard; without it the AVD takes input from the
host and no IME ever appears. Reach the WebView with:

    adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.jaskaran.conduit.dev)

#### Matching the device

`conduit-kbd36` is shaped like the phone this was reported on, because a
layout bug is a bug about a particular number of CSS pixels at a particular
density, and the default AVD is neither:

| | phone (SM-S936B) | AVD |
| --- | --- | --- |
| OS | Android 16 | Android 16 (`android-36;google_apis`) |
| screen | 1440x3120 | `hw.lcd.width/height` 1440x3120 |
| density | 600dpi | `hw.lcd.density = 600` |
| CSS viewport | 384x832 | 384x832 |
| `devicePixelRatio` | 3.75 | 3.75 |
| WebView | 153 | **133** |

The WebView version is the one thing that cannot be matched. A system image
bundles the WebView of its build date; updating it needs either a Play sign-in
on a `google_apis_playstore` image or an APK from somewhere that is not
Google. Neither is worth doing for a layout question, but it is worth knowing
before concluding anything about behaviour that Chromium has changed --
`interactive-widget=overlays-content` is honoured on 133 and not on the
phone's 153, which is exactly the kind of difference that will not reproduce.

#### Reading more than the on-screen probe

`scripts/android-keyboard-trace.mjs` records every frame of a keyboard
travel over CDP -- height, `scrollTop`, `clientHeight`, `scrollHeight` and
the distance from the bottom -- with no limit on how many. The probe drawn
on the phone is a nine-row ring because it has to fit on a phone; nothing
run from here has that constraint, and two keyboard bugs survived several
rounds because they were looked for through the phone-sized window anyway.

It needs a chat with enough history to scroll. A transcript that does not
scroll cannot tell a thread following its tail apart from one scrolled away
from it, and those are different code paths -- one of them was broken for
weeks because the emulator only ever had the first. Log the shell into a
server that has real chats (below) rather than seeding one: a throwaway
server with no model credentials cannot be seeded at all, because a send
fails before anything is persisted.

#### Pointing the shell at the development server

The emulator's `127.0.0.1` is the emulator. `adb reverse` maps its loopback
back to this machine, after which the shell's own "Use the server on this
computer" button appears and the ordinary add-server flow works:

    adb reverse tcp:4310 tcp:4310

Then log in with the Conduit password. That is currently the only way to get
an authenticated shell, and it is worth knowing why before reaching for
`conduit-auth.mjs`: `mint-session` issues browser-kind sessions, the shells
send `Authorization: Bearer`, and `validateNativeSession`
(`conduit-web/src/auth-middleware.js`) rejects any session whose `kind` is
not `native`. A minted token therefore authenticates a browser (200) and a
shell not at all (401). Issue #69 tracks closing that.

The Agent Browser mints and installs its own session and is authenticated
against the same server, but its command policy withholds `eval`, so it
gives a view and not instrumentation -- no reading `scrollTop` back, no
driving `--app-height`.

#### The on-screen probe

`src/client/navigation/keyboard-probe.ts` draws the live numbers on the
device itself, off by default and switched on by the "Show keyboard
measurements" command. It is the only instrument that works on a real phone,
so it stays in the build.

It shows every input to the height decision, a one-line summary of the last
keyboard travel -- `38f / 343ms / 111fps / gap 25ms` and the range the
heights covered -- and a nine-row ring of events. The summary exists because
a tail of a decelerating curve is its least informative part; the range
exists because a travel that ends shorter than it started went the wrong way
first. Individual animation frames are deliberately kept out of the ring:
a hundred of them push out the focus and scroll rows that are the only
reason it is there.

#### What the emulator cannot tell you

It renders through SwiftShader at around 30fps. Anything about smoothness,
frame pacing or dropped frames is the emulator describing itself. Measure
*cost* instead, which does carry across, via CDP `Performance.getMetrics`
either side of the interaction: `LayoutDuration` and `RecalcStyleDuration`
divided by the number of frames say whether the work fits in a frame budget
on any hardware. Watching an animation on the emulator says nothing.

What it *can* answer, which no amount of looking at the phone will, is where
a surface was on a given frame. `adb shell screenrecord` records the real
composited screen, keyboard included, and the frames can be measured rather
than described -- the keyboard's top edge against the composer's bottom edge
is the lag between them, in pixels, per frame. `ffmpeg` is not installed by
default; `brew install ffmpeg` provides it without root.

`screenrecord` manages about 7fps on the WSL emulator and no lower-level
setting changes that: it emits a frame per composition, and composition is
what is slow. On a hardware-accelerated host it is much better than its
average suggests -- see below.
`-gpu host` does not help, because WSL exposes no usable GPU to the
emulator -- it falls back to `llvmpipe`, and the log says so plainly
("Your GPU cannot be used for hardware rendering"). The way to resolve an
animation is to stretch it instead: `settings put global
animator_duration_scale 10` together with `window_animation_scale` turns a
285ms travel into nearly three seconds and roughly seventy usable frames.
Remember that this scales the app's animations and the system's alike, so
compare shapes rather than trusting an apparent lag between them.

#### A hardware-accelerated emulator on Windows

The WSL emulator renders in software, so it can say what arrived and not what
it looked like. An emulator run by Android Studio on the Windows host renders
on the real GPU, and can be driven from here without touching Windows: the
Windows `adb.exe` is callable across the mount, and WSL reaches the ports it
opens on `127.0.0.1` directly.

    A=/mnt/c/Users/<user>/AppData/Local/Android/Sdk/platform-tools/adb.exe
    $A -s emulator-5556 shell ...

Let Android Studio's Device Manager create the AVD and start it. Configuring
one by hand and editing `config.ini` cost an afternoon: a blank `skin.name`
refuses to boot, and a hand-built AVD on the same system image crash-looped
SurfaceFlinger (`Assertion failed: !rcEnc->featureInfo()->hasReadColorBufferDma`
in `GoldfishMapper::readFromHost`) while Studio's own AVD on that image was
fine. The symptom is a white, flashing screen with `pm` and `window` services
coming and going -- and an APK that installs but whose activity "does not
exist", because the package database is being torn down mid-write.

Everything else is a runtime setting, applied after boot, no config editing:

    $A -s emulator-5556 shell wm size 1440x3120
    $A -s emulator-5556 shell wm density 600
    $A -s emulator-5556 shell cmd overlay enable com.android.internal.systemui.navbar.threebutton
    $A -s emulator-5556 shell settings put secure stylus_handwriting_enabled 0

The last one is the trap. **The emulator reports its mouse as a stylus**, so
Gboard opens handwriting instead of the keyboard: a floating window, an IME
inset of zero height, and a shell that correctly reports no keyboard. It looks
exactly like a broken plugin. `dumpsys window displays | grep "type=ime"` tells
the two apart -- `frame=[0,3120][1440,3120]` is a zero-height IME and nothing to
track; `frame=[0,1984][1440,3120]` is a real docked keyboard.

`hw.keyboard=no` is still required and Studio's wizard sets it the other way;
that one key does have to be edited in the AVD's `config.ini`, and the emulator
restarted. Its symptom is the same zero-height inset.

A Play-image AVD may refuse adb until the debugging prompt is accepted. If the
prompt cannot be reached, killing the Windows adb server and letting the next
command restart it has cleared it. Do not kill that server casually, though:
started from WSL it often fails to daemonize, and the fix is to run
`adb.exe -a nodaemon server start` as a background process instead.

#### Measuring the edges against each other

This is what the GPU-backed emulator buys, and it is the only measurement that
can say whether the composer is actually stuck to the keyboard. `screenrecord`
there is variable-rate -- it emits a frame when the screen changes, so a still
screen costs nothing and a travel yields 36-40fps, about 23 frames across an
open and 37 across a close.

    adb shell screenrecord --bit-rate 24M --time-limit 9 /sdcard/kbd.mp4
    adb pull /sdcard/kbd.mp4
    ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 kbd.mp4
    ffmpeg -v error -i kbd.mp4 -fps_mode passthrough frames/f_%04d.png

`--fps_mode passthrough` rather than the removed `-vsync 0`, and read the real
timestamps from `ffprobe`: the container claims 90000/1 and the frames are not
evenly spaced.

Make the composer findable before recording rather than trying to recognise it
afterwards -- over CDP, `.composer-surface-shell` gets a flat red background,
the probe panel is hidden, and the composer becomes one band a script can find
by colour. Then per frame: the keyboard's top edge is the top of the bright
block that runs to the bottom of the screen, the composer's is the red band,
and the distance between them is the lag. At rest it is constant; if it opens
up during the travel, the shell is behind the keyboard by that many pixels.
Pillow is installed, so no decoder beyond `ffmpeg` is needed.

Measured this way on the emulator, the composer sits still for ~150ms of every
285ms travel and then covers the distance in ~80ms. **That number has not been
reproduced on a phone** -- the device shows no such lag -- so treat it as the
emulator's bridge latency until the same recording is made on hardware.

#### What has already been ruled out

Recorded so the same ground is not covered again:

- **Frame delivery is not the bottleneck.** The device reports ~38 frames
  over ~340ms, about 111fps, worst gap 25ms, in both directions.
- **Layout cost is not the bottleneck.** 0.30ms `LayoutDuration` and 0.56ms
  `RecalcStyleDuration` per frame, against 8.3ms at 120Hz. The transcript is
  virtualised, so this holds for long threads.
- **Chromium's scroll anchoring was not the cause** of the drift on close.
  It was measured with `overflow-anchor: none` and the drift was unchanged.
  The cause was the browser clamping `scrollTop` as the scroller grew.
- **The inset API is self-consistent, just sparse.** `onStart` gives the
  bounds, the duration and the interpolator, and each `onProgress` value is
  exactly `lerp(from, to, interpolatedFraction)`. Six callbacks arrived
  across a 285ms animation, so the shell draws the curve itself rather than
  the samples. `getLowerBound`/`getUpperBound` are a range and not a
  direction. Do not take the destination from whether the keyboard is
  arriving: that answers a show and a hide, and answers a keyboard that
  changes height while it stays visible by climbing back to the height it
  just left. The insets have already been applied for the state being
  animated to when `onStart` runs, so the end of the range nearest the
  height they report is the destination.
- **`getDurationMillis` can answer -1.** Gboard does it when the back button
  dismisses it, and the keyboard still slides. No emulator IME seen so far
  reproduces it, so it cannot be tested locally; the shell draws such a
  travel with the shape of the one before it and the probe says `ime-nodur`
  rather than `ime-start` when that path runs.
- **`@capacitor/keyboard` cannot be installed** alongside any of this. It
  registers a `WindowInsetsAnimationCompat.Callback` on the root view with
  `DISPATCH_MODE_STOP`, which stops animation dispatch to every callback
  beneath it, for every inset type. It is why per-frame tracking appeared
  impossible for several rounds.

## Which client build you are testing

Four installed builds exist, two per platform, and each pair installs **beside**
the other rather than over it. Testing the wrong one is the usual reason a fix
looks like it did not land.

| | Built by | Identifier | Signed with | Updates from |
| --- | --- | --- | --- | --- |
| **Windows, released** | CI, on a tag | `com.jaskaran.conduit.desktop` | the minisign release key | GitHub releases |
| **Windows, dev** | `npm run desktop:build:win -- --dev` | `com.jaskaran.conduit.desktop.dev` | the same key | `https://localconduit.jask-aran.com/desktop-updates` by default |
| **Android, released** | CI, on a tag | `com.jaskaran.conduit` | the persistent Android keystore | GitHub releases |
| **Android, dev** | `npm run android:build` | `com.jaskaran.conduit.dev` | the local debug key | nothing |

**The Windows dev client is the one that can test an update**. It uses the
active server route for the manifest and archive, then its built-in HTTPS
endpoint if that route has no update. Build a baseline, install it, and build
again -- `start-conduit.sh` finds the build directory by itself and serves it
at `/desktop-updates`. The full sequence is in
`docs/desktop-client.md`.

**The Android dev APK cannot test an update at all.** It is a debug-signed
local file at `conduit-web/android/app/build/outputs/apk/debug/app-debug.apk`,
installed by hand, with no update channel of its own. It reports version
`0.0.0-dev`, which is below every release, so Check for updates always offers
the latest release -- and because the identifiers differ, taking that offer
installs the *released* app beside the dev one rather than updating it. To test
a new dev build, build and sideload it again.

The Vite-based builds all write `conduit-web/dist`: `npm run build` (the
server's), `android:build` and `desktop:build:win`. Run them one at a time.
Run in parallel, they delete each other's assets, and the build fails with
`ENOENT` under `dist/assets` or, worse, packages a mix of two builds.

Both dev builds carry whatever is in the working tree. Neither is a release
candidate: a candidate is a CI artifact from a tag, and only CI holds the
signing keys that let it install over a previous release.

## Deterministic harnesses

```bash
npm run test:harness -- --help
npm run test:harness -- --profile high-tps --scenario local-high-tps
npm run test:harness:browser -- --help
npm run test:harness:browser -- --list-fixtures
npm run test:harness:browser -- --renderer incremark-synthetic --fixture table-cell-display-math
npm run test:harness:renderer -- --fixtures rich-markdown,table-cell-display-math --runs 2
```

- Transport profiles: `steady`, `burst`, `stall`, `high-tps`, `jitter`
- Transport controls: `--text`, `--chunk-size`, `--interval-ms`, `--burst-size`, `--stall-after`, `--stall-ms`, `--client-pause-after`, `--client-pause-ms`, `--seed`
- Browser flows: `stream`, `reconnect`
- Browser renderers: `marked-stable`, `marked`, `incremark`, `incremark-typewriter`, `incremark-synthetic`, `incremark-advanced`
- Browser controls: `--fixture`, `--profile`, `--pacing`, `--instrumentation`, `--paired-instrumentation`, `--chunk-size`, `--interval-ms`, `--seed`

## Capturing a real harness exchange

`CONDUIT_PI_TRACE=<file>` makes the server append every line it writes to Pi and
every line Pi writes back, with the chat id. What a transcript ends up looking
like depends on the order the harness says things in, so a test that guesses at
that order proves nothing: capture the real sequence, then encode it in
`test/transcript-pipeline.test.js`, which drives a faked Pi through the real
manager, command handling, normalizers and client projection and asserts the
rows and their order.

```bash
CONDUIT_PI_TRACE=/tmp/pi-trace.jsonl bash .devcontainer/start-conduit.sh restart
```

## What a transcript ends up looking like

These tests own this question, one per backend that states its own transcript.
Both describe the rows a reader should see rather than what the code does, so a
bug that makes a transcript wrong without making a unit test wrong fails here.

- `test/transcript-pipeline.test.js` -- Pi, faked at its stdio, through the real
  manager, command handling, normalizers and client projection. Conduit names
  the messages.
- `test/codex-transcript-pipeline.test.js` -- Codex, faked at its JSON-RPC wire,
  through the real adapter, chat log, command handling and the same client
  projection. Codex names the messages; Conduit still states where they go.
- `test/opencode-transcript-pipeline.test.js` -- OpenCode, faked at its HTTP
  routes and `/api/event` stream in the shapes 2.0.14 was recorded sending,
  through the real adapter, chat log, command handling, live generation fold
  and client projection; also what a reload reads, with and without the log.
- `test/claude-code-transcript-pipeline.test.js` -- Claude Code, faked at the
  Agent SDK (`query()` and the session helpers) in the sequences 2.1.282 was
  recorded sending, through the real adapter, chat log, command handling and
  client projection: approvals, `AskUserQuestion`, a stop, and resuming the
  saved session; also what a reload reads without the log.
- `test/codex-end-to-end.test.js` -- the same rows again, but with a real
  Conduit process, a real chat and a real WebSocket, against the fake
  app-server daemon in `test/helpers/conduit-harness.js`. Slower, and it cannot
  hold a turn open mid-flight, which is why the pipeline test above exists too.

## Other tests

```bash
npm run typecheck
npm run build
npm test
node --test test/<name>.test.js
npm run perf:live -- --target local --origin http://127.0.0.1:4310 --chat-id <id>

# repository root: this checkout's installer against this checkout, packaged as a
# thin release -- no push, no tag. --sandbox keeps it off the real daemon.
# Read docs/deployment.md "Changing the installer" first: the live installer is
# main's install.sh, and a sandbox still shares the tailnet and, without
# CONDUIT_DATA_ROOT, the password.
scripts/try-install.sh --sandbox            # --build rebuilds the client first
conduit-server-sandbox uninstall
```

- `startConduitHarness()`: isolated HTTP, WebSocket, SSE, persistence, PTY, and Pi lifecycle tests
- `perf:live`: cost-bearing provider and deployed-path timing
- `/tmp`: temporary JSON, traces, screenshots, cookie files, and browser state
