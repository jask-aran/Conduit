# Testing Conduit

Run `npm` commands and scripts from `conduit-web/`, against the local server at
`http://127.0.0.1:4310` (`bash .devcontainer/start-conduit.sh restart` after a
change). Pick the cheapest check that can prove the change; don't escalate
during iterative work.

| Tier | Cost | Commands | For |
| :--- | :--- | :--- | :--- |
| **1: Static** | seconds | `npm run typecheck`, `node --test test/<file>.test.js` | types, contracts, server routes, isolated logic |
| **2: Harnesses** | seconds | `npm run test:harness`, `npm run bench:renderer`, `curl` with a minted session | WebSocket lifecycles, streaming backpressure, Markdown/KaTeX rendering, live server HTTP headers |
| **3: Gallery** | seconds | `npm run gallery` | any component or styling change, before the app |
| **3: Browser** | 10–60s | Agent Browser, a probe, `npm run smoke:panes` | real DOM, focus and keyboard, layout, motion, panes |
| **4: Full suite** | minutes | `npm test` | release verification only |

## Local authentication

```bash
# repository root
node scripts/conduit-auth.mjs mint-session --user-agent <label> \
  --format <token|cookie|json|playwright> [--output /tmp/conduit-auth]
```

`token` is the raw session token, `cookie` a `conduit_session=...` header,
`json` the token and its metadata, `playwright` a `storageState` for external
automation. Output files are mode `0600`; omit `--output` for stdout. Agent
Browser, Windows Chrome and the probes mint their own. In a sandbox, put
`CONDUIT_DATA_ROOT` on the same command, or it touches the real password.

## Components v2 and the gallery

`npm run gallery` builds the gallery like the app (into `dist-gallery/`) and
serves `http://localhost:5180/gallery.html` (`gallery:dev` hot-reloads but
loads slowly). It needs no server, sign-in or fixtures and is never built into
`dist`. The rail lists the families (Foundations, Frosted, Transcript;
DESIGN.md Components v2), each cell tagged with its source. The right side
draws the app's real screens with v2 (`LibraryContext`): Phone
(`?frame=phone`, 412px and passing for a phone, so a headless screenshot needs
no touch emulation, `src/gallery/phone-emulation.ts`), Phone sidebar, Desktop
with its overlays, and `?live=<chat>`, a real chat from the server opened from
127.0.0.1 so the sign-in cookie comes with it. The microphone is synthetic, so
the real one is never opened. The bar's speed control slows every animation;
Tune CSS applies CSS everywhere without writing source.

### Swapping a piece to v2

The bar is no visual change the swap didn't intend. Start with
`fast-check.mjs` (~4s); steps 1-3 are for a piece whose look is meant to
stay as it was. Make one pass: don't stack repeat runs or A/Bs.

1. `node scripts/probes/style-snapshot.mjs save /tmp/before.json` on the
   current build.
2. Make the swap; look at the piece's gallery family (every form and density),
   and grep new class names for collisions.
3. Restart, `style-snapshot.mjs save /tmp/after.json`, then
   `style-snapshot.mjs diff /tmp/before.json /tmp/after.json`: every changed
   property should be one the swap meant. It covers a real chat and home at
   1280x900, and each control's focus ring; two saves with nothing changed do
   not differ.
4. A cut-over piece has no classic path (DESIGN.md, Components v2). To compare
   it with the old one, build the previous commit; don't keep a fallback in
   the app.
5. Only where the swap touches them: the motion checks below if a piece's
   moves changed; `visibility-guard.mjs` and `screen-shift.mjs` if transcript
   layout changed; the panes smoke if panes changed.

### Motion checks

Against the gallery open in headed Chrome on CDP `:9222`
(`node ../scripts/run-windows-chrome-devtools.mjs start`). Each move plays at
1x, restoring the gallery's speed after, and prints ✓, or ✗ with the
invariant it broke (DESIGN.md Motion).

- `node scripts/motion-check/phone.mjs` -- PhoneComposer: the phone preview's
  transitions and every pair of its states (~2 min).
- `node scripts/motion-check/components.mjs` -- Disclosure, CodeBlock,
  DesktopComposer.
- `node scripts/motion-check/trace-record.mjs save <file> [--phone]`, then
  `diff <before> <after>` -- one scripted Test-profile conversation (thinking,
  narration, tools, stopped while writing, a tool denied, stopped at an
  approval, a plain answer): each turn's states, where its main thread's time
  went, and every trace settled with each step opened. Two recordings of one
  build do not differ. Before and after a change to what draws the trace.
- `node scripts/motion-check/trace-parity.mjs [--chat <id>]` -- with the
  gallery served and :4310 signed in in that Chrome: makes a Test-profile chat
  (or checks an existing one), loads it into the gallery's phone preview and
  walks both traces, printing each line that differs. Settled turns only.
- `node scripts/motion-check/trace-stream.mjs ["<prompt>"] [stop]` -- the same
  prompt streamed in the app and in the gallery's live phone, each on a fresh
  chat, comparing the states each passes through: one shown 150ms or more must
  show on both, in order. It also lists answers drawn and then taken away.
  `--model <spec>` runs a real model on the Assistant profile (`--profile
  coding` for codemode scripts); `--budget` traces each side and prints every
  task over 6.94ms with what ran. Other pages in that Chrome share its CPU, so
  counts vary several-fold: read the slow tasks, don't compare counts.

## Panes smoke

`npm run smoke:panes [-- --project <name>]` drives the panes and file viewer
in headless Chromium and prints `ok`/`FAIL` per scenario, exiting 1 on any
failure. It is read-only, each scenario in a fresh context so the saved layout
starts empty; it picks the first project with six top-level files, and a
project whose page lists files also covers the project page. Playwright comes
from `conduit-web` or is installed once into `.smoke-tools/`. Run it from the
checkout the server serves (its session goes into that checkout's data), after
any change to panes, tabs, drag, header folding or the dock -- performance
work included. The tab rules are unit tests in `test/file-tabs.test.js`.

## Browsers

### Agent Browser

Authenticated navigation, accessibility, screenshots and ordinary UI QA:

```bash
curl -fsS http://127.0.0.1:4310/healthz
npm run qa:agent-browser                       # prints a session id
npm run agent-browser:local -- --session <id> --restore snapshot -i -c
npm run agent-browser:local -- --session <id> --restore a11y
npm run agent-browser:local -- --session <id> --restore screenshot /tmp/conduit.png
npm run agent-browser:local -- --session <id> close
```

Commands: navigate (`open`, `back`, `forward`, `reload`, `wait`), inspect
(`snapshot`, `read`, `get`, `is`, `find`, `a11y`, `console`, `errors`),
interact (`click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`,
`focus`, `check`, `uncheck`, `select`, `drag`, `scroll`, `scrollintoview`),
evidence (`screenshot`, `diff snapshot`). Reference: `agent-browser skills get
core --full`. Its policy withholds `eval`, so it gives a view, not
instrumentation, and it is not a performance surface.

### Windows Chrome DevTools

The headed native frame: compositor, GPU, paint, layout, console, network and
memory, at the user's display scaling. Persistent profile
`C:\Users\jaska\AppData\Local\Conduit\chrome-agent`, CDP `:9222` (reachable
from WSL at `http://127.0.0.1:9222`).

```bash
node ../scripts/run-windows-chrome-devtools.mjs start
node ../scripts/run-windows-chrome-devtools.mjs cli list_pages
node ../scripts/run-windows-chrome-devtools.mjs cli new_page http://127.0.0.1:4310/
node ../scripts/run-windows-chrome-devtools.mjs cli take_snapshot
node ../scripts/run-windows-chrome-devtools.mjs stop-cli   # leaves Chrome running
```

`cli` takes pages (`list_pages`, `new_page`, `select_page`, `navigate_page`,
`close_page`, `resize_page`), inspect (`take_snapshot`, `take_screenshot`,
`evaluate_script`, console and network requests), interact (`click`,
`click_at`, `hover`, `drag`, `fill`, `type_text`, `press_key`,
`handle_dialog`, `upload_file`), performance (`performance_start_trace`,
`performance_analyze_insight`, `lighthouse_audit`) and memory
(`take_heapsnapshot`, `compare_heapsnapshots` and details). Reference:
`chrome-devtools <command> --help`.

The server serves a production build with a service worker that keeps the old
bundle after a rebuild (a new worker waits; `conduit-web/README.md`, Progressive web app).
Before measuring, clear it in the page and confirm the hashed chunk name in
the network log changed:

```js
navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
location.reload();
```

## Probes

`scripts/probes/`, run from the checkout the server serves. Each opens its own
page in headless Chromium with a minted session; `--windows` uses the headed
Chrome on :9222 instead, the only place display scaling and frame cost are
real. A probe killed mid-run leaves its page open there -- close it before the
next run, or the next load can hang.

| Probe | Answers |
| --- | --- |
| `style-snapshot.mjs save <file>` / `diff <a> <b>` | Did a change move anything the app draws? |
| `gallery-style-diff.mjs <buildA> <buildB> [--ignore --a,--b] [--keys]` | Did a library change move anything in the gallery? Every element's computed style, every family at both densities and the previews, between two `npx vite build --mode gallery --outDir <dir>` builds; no server. A refactor is done when it prints IDENTICAL (or only the custom properties it renamed). |
| `settle-stability.mjs` | Does a turn hold still as it settles, stops (also from an approval) or takes a steered message? Asserted, no model call; the gate for transcript live/settle changes. A turn a harness ends without stating its outcome is logged in the server journal as `transcript contract: ...`. |
| `fast-check.mjs [prompt] [out]` | The quick look at a renderer change, in about 4s: one `rich 2000t` loop at 1000 tokens/s, recording the answer's DOM churn (added/removed by kind), every code card shape seen while streaming, and the settled answer (`<out>.html`, `<out>.cards`). Run before and after and `cmp` the files; motion still needs `visibility-guard.mjs`. |
| `visibility-guard.mjs [prompt] [--phone] [--examples]` | What the transcript's virtualization shows each frame through a long streamed answer scrolled every way a reader and the app do: blank frames, unexplained moves, placeholders back at a different height, any move down while following. Before and after a virtualization or layout change; no count may rise. It reads layout every frame, so it times nothing. |
| `screen-shift.mjs [prompt] [--phone]` | How the transcript moves on screen while streaming, from the screencast's pixels; nothing runs in the page. Lists every frame that moved down while following, with the time since the last code block opened. |
| `placeholder-heights.mjs` | Do off-screen blocks hold their real height? |
| `press-shift.mjs` | Does pressing and holding a resize handle move any formula, table or block, or change a pixel? |
| `reload-settle.mjs --out <dir>` | What moves after the first open's fade starts? Saves a frame series and an attribute and animation timeline. |
| `motion-rules.mjs` | Which loaded rules set containment, `will-change`, transforms or `content-visibility`, and which apply only under an interaction state? |
| `dock-layer-frames.mjs` | Does the dock hold still switching between beside and over the panes? |
| `dictation-row.mjs` | How the phone composer's row moves as dictation starts and stops, empty and with a draft (synthetic mic). |
| `send-motion.mjs` | What moves when a message is sent from the phone composer; saves a frame strip. |
| `stream-budget.mjs` | Tasks over 6.94ms while an answer streams, what ran in them, how evenly the text appeared. Live model call. |
| `turn-profile.mjs [prompt] [--app \| --phone] [--save <file>]` | Where a streamed Test-profile turn's main-thread time goes, by trace state: % busy, frames the compositor drew and dropped (the frame rate; main-thread paints a second are not it), tasks against 6.94ms, rendering by phase, JS self time by function. `--phone` is 412x860 at 2.625x with touch. A run of slow frames whose element counts match their neighbours' is the machine, not the page. Build with source maps for names. |
| `call-counts.mjs [prompt] [--phone] [--match <text>] [--top N]` | How many times each function ran in one streamed turn, per socket message and frame. Counts don't vary run to run, so they state exactly what a change removed. Build with source maps first. |
| `load-waterfall.mjs [--rtt <ms>] [--cpu 4] [--runs <n>]` | How long the first open takes to its fade, and what it waits on. |
| `load-profile.mjs [--cpu 4] [--slices]` | What the first open spends its main thread on. Names after `npx vite build --sourcemap`; rebuild without it afterwards. |
| `resume-reconnect.mjs [--away <ms>]` | How long a page takes to be live again after time in the background. |

### Frame budget

6.94ms per task (144Hz), measured from a trace, never from gaps between
animation frames. In headed Windows Chrome, drive the page with Playwright
`chromium.connectOverCDP` and `Tracing.start` with only
`devtools.timeline,toplevel` (`stream-budget.mjs --windows` does this). Don't
use the CLI's `performance_start_trace` for frame numbers on DOM-heavy work:
it turns on invalidation tracking, which reported ten times the over-budget
tasks on a KaTeX stream.

For streaming-render faults, replay the Test profile's KaTeX models in the
`test` project and check every frame for a math element removed or emptied,
or TeX commands outside math.

### Layout stability

Text that shifts and settles is measured, not judged by eye (DESIGN.md
Transcript). Prefer finding the structure that changes geometry over adding
delays.

- **Headed Windows Chrome at the user's scaling.** At a fractional DPR
  anything on its own layer (`contain: paint`, `will-change`, a transform)
  snaps to whole device pixels, so text jumps when such a rule switches on.
  Headless at DPR 1 cannot show this.
- **Read the stylesheet first** (`motion-rules.mjs`): a rule that applies only
  while a handle is held is the first suspect for a shift on press.
- **Diff screenshots around the interaction.** Press, hold and release with
  CDP `Input.dispatchMouseEvent`, screenshotting each step; zero changed pixels
  between rest and press is the bar.
- **Take every element's rect, not a sample**: only some formulas move, always
  the same ones.
- **Check placeholders against real heights**: each off-screen block's
  `contain-intrinsic-block-size` against its height once revealed.
- **Step animations frame by frame**: slow them with CDP
  `Animation.setPlaybackRate` (0.1–0.2) and step a width across a switch in
  both directions. Measure in a microtask after Solid's effect, before paint.

## The Test profile

A chat on the `test-stream` profile (`src/test-stream-adapter.js`) answers
instantly and deterministically, with no model call. The model picks the pace
(`paced-60` about a real model, `fast-250`, `fast-1000`, `flood-4000`); the
thinking level picks how many tokens. Words in the prompt shape the turn, and
the same prompt always produces the same turn:

| In the prompt | Turn |
| --- | --- |
| `1500t` | an answer of exactly 1500 tokens, whatever the level says |
| `tool`, `3 tools` | that many calls, one a message, then the answer |
| `narrate` | a sentence of narration before each call |
| `rich` | realistic text (punctuation past Latin-1, which V8 keeps as two-byte strings, lists, a table, inline and display formulas, a five-line code block and a 137-line source file), the thinking typographic prose; plain prompts stream ASCII words |
| `approve` | each call asks for approval; denied, it fails with the refusal and the turn goes on, as Pi returns a blocked call |
| `think`, `think 900` | thinking, 400 tokens or the number given, shared across the turn's messages (`think 900 1500t`) |

Sending while it answers steers, as a real harness reads its queue: after a
tool call the message joins the turn; once the answer has ended it starts the
next turn; never between thinking and its answer. Stopping keeps the partial
answer.

## Transcript pipeline tests

What a transcript ends up looking like is owned by tests that describe the rows
a reader sees, so a bug that makes a transcript wrong without making a unit
test wrong fails here. A transcript bug gets a failing test here first.

- `test/transcript-pipeline.test.js` -- Pi, faked at its stdio, through the
  real manager, command handling, normalizers and client projection.
- `test/codex-transcript-pipeline.test.js` -- Codex, faked at its JSON-RPC
  wire.
- `test/opencode-transcript-pipeline.test.js` -- OpenCode, faked at its HTTP
  routes and event stream as 2.0.14 sends them; also what a reload reads.
- `test/claude-code-transcript-pipeline.test.js` -- Claude Code, faked at the
  Agent SDK as 2.1.282 sends it: approvals, `AskUserQuestion`, a stop,
  resuming; also what a reload reads.
- `test/codex-end-to-end.test.js` -- a real Conduit process, chat and socket
  against the fake app-server in `test/helpers/conduit-harness.js`; slower and
  cannot hold a turn mid-flight.

Encode the order a harness really says things in, captured, not guessed:

```bash
CONDUIT_PI_TRACE=/tmp/pi-trace.jsonl bash .devcontainer/start-conduit.sh restart
```

## Harnesses and live timing

```bash
npm run test:harness -- --help
npm run test:harness -- --profile high-tps --scenario local-high-tps
npm run bench:renderer
npm run perf:live -- --target local --origin http://127.0.0.1:4310 --chat-id <id>
```

Transport profiles `steady`, `burst`, `stall`, `high-tps`, `jitter`; controls
`--text`, `--chunk-size`, `--interval-ms`, `--burst-size`, `--stall-after`,
`--stall-ms`, `--client-pause-after`, `--client-pause-ms`, `--seed`.
`startConduitHarness()` (`test/helpers/conduit-harness.js`) gives isolated
HTTP, WebSocket, SSE, persistence, PTY and Pi lifecycle tests. `perf:live`
makes real provider calls and costs money.

## Which client build you are testing

Each platform has a released and a dev build that install **beside** each
other; testing the wrong one is the usual reason a fix looks like it did not
land.

| | Built by | Identifier | Signed with | Updates from |
| --- | --- | --- | --- | --- |
| Windows, released | CI, on a tag | `com.jaskaran.conduit.desktop` | the minisign release key | GitHub releases |
| Windows, dev | `npm run desktop:build:win -- --dev` | `com.jaskaran.conduit.desktop.dev` | the same key | the active server's `/desktop-updates`, else `https://localconduit.jask-aran.com/desktop-updates` |
| Android, released | CI, on a tag | `com.jaskaran.conduit` | the release keystore | GitHub releases |
| Android, dev | `npm run android:build` | `com.jaskaran.conduit.dev` | the local debug key | the connected server's interface bundle only |

- **Testing a Windows update:** build and install a dev baseline, restart the
  server, build a newer dev installer; the server finds the output and serves
  `/desktop-updates`. Use the client's Restart once its download completes.
- **The Android dev APK cannot test an update.** It reports `0.0.0-dev`, so
  Check for updates offers the latest release, which installs *beside* it.
  Native changes need a new APK, sideloaded.
- `npm run build`, `android:build` and `desktop:build:win` all write
  `conduit-web/dist`: run them one at a time, or they delete each other's
  assets or package a mix. Dev builds carry the working tree and are never
  release candidates.

## Android

Headless checks cover routine menu and focus permutations. Use a device for
native Back, real keyboard timing, camera scanning and WebView frost; pairing
and installing prove none of those.

### The paired phone

The SM-S936B runs `com.jaskaran.conduit.dev`, paired for wireless ADB through
the **Windows** `adb.exe` (Linux ADB pairing fails with `protocol fault`).
WSL's adb uses that server via `ADB_SERVER_SOCKET`; Android CLI does not see
the phone through it, and the working server is worth more than Android CLI,
so don't replace it. Keep addresses, ports and identifiers out of this
document.

- Check `adb devices -l` first and select the phone with `-s` (it can appear
  under two aliases).
- An empty list may only mean a new port: `adb.exe mdns services` lists
  `_adb-tls-connect` (stale entries linger); connect to the newest. If that
  fails with no reason the pairing was lost: Wireless debugging → Pair device
  with pairing code, `adb.exe pair <_adb-tls-pairing address> <code>`, connect
  again.
- Install with `adb -s "$PHONE_SERIAL" install -r <apk>` (`wslpath -w` for
  `adb.exe`), check for `Success`, reopen Conduit Dev; app data is kept.
- Shell commands take ~30ms and a screenshot ~1s: fine for short scripted
  interaction. Record with `screenrecord` on the phone and pull the video
  rather than looping screenshots.

### The WSL emulator

It answers what arrives -- events, order, geometry, inset dispatch -- not how
it looks.

```bash
/usr/bin/sg kvm -c "$ANDROID_HOME/emulator/emulator -avd conduit-kbd36 \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot"
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.jaskaran.conduit.dev)
adb reverse tcp:4310 tcp:4310   # then "Use the server on this computer" and the password
```

- `sg` is shadowed by ast-grep, hence the path. `hw.keyboard = no` in
  `config.ini` forces the soft keyboard.
- `conduit-kbd36` matches the phone (Android 16, 1440x3120 at 600dpi, CSS
  384x832 at DPR 3.75) except its WebView: 133 against the phone's 153, and
  Chromium differs between them (`interactive-widget=overlays-content` is
  honoured only on 133). Check before concluding anything about browser
  behaviour.
- Sign the shell in with the password. A minted session can't: `mint-session`
  issues browser-kind sessions and `validateNativeSession`
  (`src/auth-middleware.js`) accepts only `native` ones (issue #69).
- Use a server with real chats long enough to scroll: a transcript that cannot
  scroll can't tell following the tail from being scrolled away, which are
  different code paths. A throwaway server without model credentials can't be
  seeded at all.
- It renders in software at ~30fps, so smoothness is the emulator describing
  itself. Measure cost: CDP `Performance.getMetrics` either side of an
  interaction, `LayoutDuration` and `RecalcStyleDuration` per frame.
- `scripts/android-keyboard-trace.mjs` records every frame of a keyboard
  travel (height, `scrollTop`, client and scroll height, distance from the
  bottom) with no limit.
- `screenrecord` manages ~7fps here; stretch animations instead with
  `settings put global animator_duration_scale 10` and
  `window_animation_scale` (app and system alike, so compare shapes, not
  apparent lag). `ffmpeg`: `brew install ffmpeg`.

**On a real phone**, `src/client/navigation/keyboard-probe.ts` draws the live
numbers on the device: off by default, on with the "Show keyboard
measurements" command. It shows every input to the height decision, a summary
of the last keyboard travel and a ring of events.

### A GPU emulator on Windows

An emulator run by Android Studio renders on the real GPU, so it shows what a
frame looked like; drive it from WSL with the Windows `adb.exe`
(`.../Android/Sdk/platform-tools/adb.exe -s emulator-5556 ...`).

- Let Studio's Device Manager create and start the AVD; a hand-built one on
  the same image crash-looped SurfaceFlinger. Edit only `hw.keyboard=no` in its
  `config.ini` (Studio sets it the other way) and restart it.
- After boot: `wm size 1440x3120`, `wm density 600`, `cmd overlay enable
  com.android.internal.systemui.navbar.threebutton`, and `settings put secure
  stylus_handwriting_enabled 0` -- **the emulator's mouse is a stylus**, so
  otherwise Gboard opens handwriting with a zero-height inset that looks
  exactly like a broken plugin. `dumpsys window displays | grep "type=ime"`
  tells them apart.
- A Play image may refuse adb until its debugging prompt is accepted; killing
  the Windows adb server can clear it, but restart it with `adb.exe -a
  nodaemon server start` in the background (started from WSL it often fails
  to daemonize).
- `screenrecord` there is variable-rate (~37fps across a travel). To measure
  the composer against the keyboard: give `.composer-surface-shell` a flat red
  background over CDP, record, take real timestamps with `ffprobe` (the
  container's rate is wrong), split frames with `ffmpeg -fps_mode
  passthrough`, then per frame the keyboard's top edge against the red band is
  the lag in pixels.

### Already ruled out for keyboard tracking

- Frame delivery (~111fps on the device) and layout cost (~0.3ms layout and
  ~0.6ms style per frame) are not the bottleneck.
- Scroll anchoring did not cause the drift on close; the browser clamping
  `scrollTop` as the scroller grew did.
- The inset API is self-consistent but sparse (six callbacks over 285ms), so
  the shell draws the curve itself. Take the destination from the end of the
  range nearest the insets already applied, not from whether the keyboard is
  arriving.
- Gboard can report `getDurationMillis` -1 on Back while still sliding; no
  emulator IME reproduces it (the probe says `ime-nodur`).
- `@capacitor/keyboard` cannot be installed alongside: its
  `DISPATCH_MODE_STOP` callback stops inset animation dispatch to every
  other.

## Release and install

`npm test` before tagging a release. Test installer changes with this
checkout's installer against this checkout, never by pushing `main` (read
DEPLOYMENT.md Development and Release first; a sandbox still shares the
tailnet and, without `CONDUIT_DATA_ROOT`, the password):

```bash
# repository root
scripts/try-install.sh --sandbox     # --build rebuilds the client first
conduit-server-sandbox uninstall
```
