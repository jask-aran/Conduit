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
| **Tier 4: Broad Sweeps & Canaries** | 30s–5m+ | **Prohibitive** (context poison) | `npm test` | Release verification only. **Do not run during iterative coding turns.** |

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
is the lag between them, in pixels, per frame. `ffmpeg` is not installed;
`imageio-ffmpeg` in a virtualenv provides a static binary without root.

`screenrecord` manages about 7fps here and no lower-level setting changes
that: it emits a frame per composition, and composition is what is slow.
`-gpu host` does not help, because WSL exposes no usable GPU to the
emulator -- it falls back to `llvmpipe`, and the log says so plainly
("Your GPU cannot be used for hardware rendering"). The way to resolve an
animation is to stretch it instead: `settings put global
animator_duration_scale 10` together with `window_animation_scale` turns a
285ms travel into nearly three seconds and roughly seventy usable frames.
Remember that this scales the app's animations and the system's alike, so
compare shapes rather than trusting an apparent lag between them.

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
  direction -- take the destination from whether the keyboard is arriving.
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
| **Windows, dev** | `npm run desktop:build:win -- --dev` | `com.jaskaran.conduit.desktop.dev` | the same key | `http://127.0.0.1:4310/desktop-updates` |
| **Android, released** | CI, on a tag | `com.jaskaran.conduit` | the persistent Android keystore | GitHub releases |
| **Android, dev** | `npm run android:build` | `com.jaskaran.conduit.dev` | the local debug key | nothing |

**The Windows dev client is the one that can test an update**, because its
updater points at this machine. Build a baseline, install it, build again, and
press Check for updates -- `start-conduit.sh` finds the build directory by
itself and serves it at `/desktop-updates`. The full sequence is in
`docs/desktop-client.md`.

**The Android dev APK cannot test an update at all.** It is a debug-signed
local file at `conduit-web/android/app/build/outputs/apk/debug/app-debug.apk`,
installed by hand, with no update channel of its own. It reports version
`0.0.0-dev`, which is below every release, so Check for updates always offers
the latest release -- and because the identifiers differ, taking that offer
installs the *released* app beside the dev one rather than updating it. To test
a new dev build, build and sideload it again.

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

Two tests own this question, one per backend that states its own transcript.
Both describe the rows a reader should see rather than what the code does, so a
bug that makes a transcript wrong without making a unit test wrong fails here.

- `test/transcript-pipeline.test.js` -- Pi, faked at its stdio, through the real
  manager, command handling, normalizers and client projection. Conduit names
  the messages.
- `test/codex-transcript-pipeline.test.js` -- Codex, faked at its JSON-RPC wire,
  through the real adapter, chat log, command handling and the same client
  projection. Codex names the messages; Conduit still states where they go.
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

# repository root
./scripts/package-release.sh <commit>
./scripts/prove-deployment.sh
```

- `startConduitHarness()`: isolated HTTP, WebSocket, SSE, persistence, PTY, and Pi lifecycle tests
- `perf:live`: cost-bearing provider and deployed-path timing
- `/tmp`: temporary JSON, traces, screenshots, cookie files, and browser state
