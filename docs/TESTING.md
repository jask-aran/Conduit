# Testing Conduit

Run `npm` commands and web scripts from `conduit-web/` unless marked otherwise. Checks that need the app use the
local server at `http://127.0.0.1:4310` (`bash .devcontainer/start-conduit.sh restart` from the repository root after
a change). Pick the cheapest check that can prove the change; don't escalate during iterative work.

| Tier | Cost | Commands | For |
| :--- | :--- | :--- | :--- |
| **1: Static** | seconds | `npm run typecheck`, `node --test test/<file>.test.js` | types, contracts, server routes, isolated logic |
| **2: Server** | seconds | `curl` against `/v0/...` with a minted cookie | routes, state, what the server returns |
| **3: Gallery** | seconds | `npm run gallery` | any component or styling change, before the app |
| **3: App** | 10–60s | Windows Chrome DevTools CLI, a probe, `npm run smoke:panes` | real DOM, focus and keyboard, layout, motion, panes |
| **4: Full suite** | minutes | `npm test` | release verification only |

**The tests only shrink.** Rule 8 of `scripts/check-conventions.mjs` holds tests, test lines, test files and Markdown
lines to `budgets.json`, each only allowed to fall; typecheck, the build, restart and `npm test` check it. A change
that needs a new test cuts more than it adds (tests that pin wording, source text or a stub's shape go first). Record
a lower figure with `node scripts/check-conventions.mjs --record` (it refuses a rise).

## Local authentication

Drive the server with a minted cookie (repository root; `node scripts/conduit-auth.mjs help` for the options):

```bash
C=$(node scripts/conduit-auth.mjs mint-session --user-agent probe --format cookie)
curl -s -H "Cookie: $C" -H "Origin: http://127.0.0.1:4310" http://127.0.0.1:4310/v0/agent
curl -s http://127.0.0.1:4310/healthz
```

Match `CONDUIT_DATA_ROOT` to the server; it defaults to `~/.conduit/data`, shared across checkouts. In a sandbox, put
it on the same command, or it touches the real auth store. Minting requires an existing password and preserves it.

## Components v2 and the gallery

`npm run gallery` serves `http://localhost:5180/gallery.html` (`gallery:dev` hot-reloads but loads slowly). It needs
no server or sign-in. `?frame=phone` is the phone preview; `?live=<chat>` is a real chat from the server, opened from
127.0.0.1 so the sign-in cookie comes with it.

Toast → **Live notifications** uses the app's real Sonner adapter: check entrance, stacking, replacement, actions and
exit through the motion, not only once the toast settles. The animated `[data-sonner-toast]` must itself be the
`.ui-frost.ui-toast-frame`; its embedded `.ui-toast` has no second frost.

### Connection and access screens

`GET /login?after=%2Fchat%2Fexample` shows the sign-in form without signing out the current session. It must load
its hashed CSS without a session, contain no scripts, focus Password, and keep `/chat/example` in the hidden `after`
field. Use the isolated auth tests for authentication changes; never test wrong passwords or rate limiting against
the user's live server:

```bash
node --test --test-name-pattern='unauthenticated routes|login flow|login redirect target' test/auth-server.test.js
```

Without a build the auth fixture serves a stand-in form, so build first to cover the page itself.

For phone menu checks use Chrome CLI `emulate --viewport '412x860x2.625,mobile,touch'`; resizing the window does not
set the coarse-pointer layout. Check: keyboard opening focuses the first available child; pointer opening focuses
inside the child without selecting a choice; tapping the dimmed parent returns without acting on a parent row;
Escape goes back to the parent; selection closes both menus and restores the trigger; disabled choices.

### Swapping a piece to v2

The bar is no visual change the swap didn't intend. Make one pass: don't stack repeat runs or A/Bs.

1. Run `fast-check.mjs` (~4s) before and after the swap and `cmp` the output.
2. Look at the piece's gallery family (every form and density), and grep new class names for collisions.
3. To compare with the old piece, build the previous commit; don't keep a fallback in the app.
4. Only where the swap touches them: the motion checks below if a piece's moves changed; `visibility-guard.mjs` and
   `screen-shift.mjs` if transcript layout changed; the panes smoke if panes changed.

### Motion checks

Against the gallery open in headed Chrome on CDP `:9222` (`node ../scripts/run-windows-chrome-devtools.mjs start`).
Each prints ✓, or ✗ with the invariant it broke (DESIGN.md Motion).

- `node scripts/motion-check/phone.mjs` -- PhoneComposer, every pair of its states (~2 min).
- `node scripts/motion-check/components.mjs` -- Disclosure, CodeBlock, DesktopComposer.

## Panes smoke

`npm run smoke:panes [-- --project <name>]` after any change to panes, tabs, drag, header folding or the dock --
performance work included. Run it from the checkout the server serves, with its `CONDUIT_DATA_ROOT`.

## Browsers

### Windows Chrome DevTools

The headed native frame at the user's display scaling, CDP `:9222` (reachable from WSL at `http://127.0.0.1:9222`).

```bash
node ../scripts/run-windows-chrome-devtools.mjs start
node ../scripts/run-windows-chrome-devtools.mjs cli new_page http://127.0.0.1:4310/
node ../scripts/run-windows-chrome-devtools.mjs cli take_screenshot
node ../scripts/run-windows-chrome-devtools.mjs cli evaluate_script '() => document.title'
node ../scripts/run-windows-chrome-devtools.mjs cli emulate --viewport '412x860x2.625,mobile,touch'
node ../scripts/run-windows-chrome-devtools.mjs stop-cli   # leaves Chrome running
```

`cli` forwards to the external `chrome-devtools` tool (`chrome-devtools <command> --help`).

The service worker keeps the old bundle after a rebuild (`src/client/pwa-update.ts`). Before measuring, clear it in
the page and confirm the hashed chunk name in the network log changed:

```js
navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
location.reload();
```

## Probes

`scripts/probes/`, run from the checkout the server serves, with its `CONDUIT_DATA_ROOT`. Each file's header says what
it measures and how to run it. Most open their own headless page with a minted session; `--windows` uses the
signed-in headed Chrome on :9222, where display scaling and frame cost are real. A probe killed mid-run leaves its
page open in Windows Chrome: close it before the next run, or the next load can hang.

When to run which:

- `gallery-style-diff.mjs` -- a library refactor: done when it prints IDENTICAL (or only the custom properties it
  renamed).
- `settle-stability.mjs` -- the gate for transcript live/settle changes.
- `fast-check.mjs` -- before and after a renderer change, `cmp` the outputs.
- `visibility-guard.mjs`, `screen-shift.mjs` -- before and after a virtualization or layout change; no count may rise.
- `stream-budget.mjs`, `turn-profile.mjs` -- frame cost while streaming.
- `reload-settle.mjs`, `dictation-row.mjs`, `send-motion.mjs`, `resume-reconnect.mjs` -- what moves on first open,
  dictation and send; how long a page takes to be live after the background.

### Frame budget

6.94ms per task (144Hz), measured from a trace, never from gaps between animation frames. In headed Windows Chrome,
drive the page with Playwright `chromium.connectOverCDP` and `Tracing.start` with only `devtools.timeline,toplevel`
(`stream-budget.mjs --windows` does this). Don't use the CLI's `performance_start_trace` for frame numbers on
DOM-heavy work: it turns on invalidation tracking and inflates the over-budget tasks.

For streaming-render faults, replay the Render test profile's KaTeX replies in the `test` project and check every
frame for a math element removed or emptied, or TeX commands outside math.

### Layout stability

Text that shifts and settles is measured, not judged by eye (DESIGN.md Transcript). Find the structure that changes
geometry rather than adding delays.

- **Headed Windows Chrome at the user's scaling.** At a fractional DPR anything on its own layer (`contain: paint`,
  `will-change`, a transform) snaps to whole device pixels. Headless at DPR 1 cannot show this.
- **Read the stylesheet first**: a rule that applies only while a handle is held is the first suspect for a shift on
  press.
- **Diff screenshots around the interaction.** Press, hold and release with CDP `Input.dispatchMouseEvent`,
  screenshotting each step; zero changed pixels between rest and press is the bar.
- **Take every element's rect, not a sample.**
- **Check placeholders against real heights**: each off-screen block's `contain-intrinsic-block-size` against its
  height once revealed.
- **Step animations frame by frame** with CDP `Animation.setPlaybackRate` (0.1–0.2), stepping a width across a switch
  in both directions. Measure in a microtask after Solid's effect, before paint.

## The Render test profile

A chat on the `test-stream` profile (`src/test-stream-adapter.js`) answers instantly and deterministically, with no
model call. The model picks the pace (`paced-60`, `bursty-60`, `fast-250`, `fast-1000`, `flood-4000`); the thinking
level picks how many tokens. Words in the prompt shape the turn:

| In the prompt | Turn |
| --- | --- |
| `1500t` | an answer of exactly 1500 tokens, whatever the level says |
| `tool`, `3 tools` | that many calls, one a message, then the answer |
| `narrate` | a sentence of narration before each call |
| `rich` | realistic text (two-byte punctuation, lists, a table, formulas, a code block and a 137-line source file); plain prompts stream ASCII words |
| `markdown`, `katex`, `katex limits` | a whole recorded reply, whatever the level says |
| `approve` | each call asks for approval; denied, it fails with the refusal and the turn goes on |
| `think`, `think 900` | thinking, 400 tokens or the number given (`think 900 1500t`) |

Sending while it answers steers: after a tool call the message joins the turn; once the answer has ended it starts
the next turn. Stopping keeps the partial answer. Render test is the profile for paint and pace pressure: forks, tree
history, kept partials and the probes run on it.

## The Test profile

The `test` profile runs the real runtime -- subagents, codemode scripts, question cards, context steps, reports -- on
a scripted model (`src/server/scripted-model.js`), with no credentials or cost. Send `help` for its keywords.

## Transcript pipeline tests

A transcript bug gets a failing test here first: these describe the rows a reader sees, faked at each harness's wire
in the order the harness really says things (captured, not guessed).

- `test/codex-transcript-pipeline.test.js`, `test/opencode-transcript-pipeline.test.js`,
  `test/claude-code-transcript-pipeline.test.js`.
- `test/codex-end-to-end.test.js` -- a real Conduit process against the fake app-server in
  `test/helpers/conduit-harness.js` (`startConduitHarness()`, also for HTTP, WebSocket and restart checks).

`npm run bench:renderer` times the transcript renderer without a server.

## Which client build you are testing

Each platform has a released and a dev build that install **beside** each other; testing the wrong one is the usual
reason a fix looks like it did not land.

| | Built by | Identifier | Signed with | Updates from |
| --- | --- | --- | --- | --- |
| Windows, released | CI, on a tag | `com.jaskaran.conduit.desktop` | the minisign release key | GitHub releases |
| Windows, dev | `npm run desktop:build:win -- --dev` | `com.jaskaran.conduit.desktop.dev` | the same key | the active server's `/desktop-updates`, else `https://conduit-local.jask-aran.com/desktop-updates` |
| Android, released | CI, on a tag | `com.jaskaran.conduit` | the release keystore | GitHub releases |
| Android, dev | `npm run android:build` | `com.jaskaran.conduit.dev` | the local debug key | the connected server's interface bundle only |

- **Testing a Windows update:** build and install a dev baseline, restart the server, build a newer dev installer;
  the server serves it at `/desktop-updates`. Use the client's Restart once its download completes.
- **The Android dev APK cannot test a release update in place.** It reports `0.0.0-dev-dev`, so Check for updates
  offers the latest release, which installs beside it. Native changes need a new APK, sideloaded.
- `npm run build`, `android:build` and `desktop:build:win` all write `conduit-web/dist`: run them one at a time. Dev
  builds carry the working tree and are never release candidates.

## Android

Headless checks cover routine menu and focus permutations. Use a device for native Back, real keyboard timing, camera
scanning and WebView frost; pairing and installing prove none of those.

### The paired phone

The phone runs `com.jaskaran.conduit.dev`, paired for wireless ADB through the **Windows** `adb.exe` (Linux ADB
pairing fails with `protocol fault`). WSL's adb uses that server via `ADB_SERVER_SOCKET`; don't replace it. Keep
addresses, ports and identifiers out of this document.

- Check `adb devices -l` first and select the phone with `-s` (it can appear under two aliases).
- An empty list may only mean a new port: `adb.exe mdns services` lists `_adb-tls-connect` (stale entries linger);
  connect to the newest. If that fails with no reason the pairing was lost: Wireless debugging → Pair device with
  pairing code, `adb.exe pair <_adb-tls-pairing address> <code>`, connect again.
- Install with `adb -s "$PHONE_SERIAL" install -r <apk>` (`wslpath -w` for `adb.exe`), check for `Success`, reopen
  Conduit Dev; app data is kept.
- Record with `screenrecord` on the phone and pull the video rather than looping screenshots.

### The WSL emulator

It answers what arrives -- events, order, geometry, inset dispatch -- not how it looks.

```bash
/usr/bin/sg kvm -c "$ANDROID_HOME/emulator/emulator -avd conduit-kbd36 \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot"
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.jaskaran.conduit.dev)
adb reverse tcp:4310 tcp:4310   # then "Use the server on this computer" and the password
```

- `sg` is shadowed by ast-grep, hence the path. `hw.keyboard = no` in `config.ini` forces the soft keyboard.
- `conduit-kbd36` matches the phone's screen but not its WebView version, and Chromium differs between them
  (`interactive-widget=overlays-content` is honoured only on the older one). Check before concluding anything about
  browser behaviour.
- Sign the shell in with the password: `mint-session` issues `script` sessions and `validateNativeSession`
  (`src/auth-middleware.js`) accepts only `native` ones.
- Use a server with chats long enough to scroll: following the tail and being scrolled away are different code paths.
  The Test and Render test profiles can seed a throwaway server without model credentials.
- It renders in software at ~30fps, so smoothness is the emulator describing itself. Measure cost: CDP
  `Performance.getMetrics` either side of an interaction, `LayoutDuration` and `RecalcStyleDuration` per frame.
- `screenrecord` manages ~7fps here; stretch animations instead with `settings put global animator_duration_scale 10`
  and `window_animation_scale` (app and system alike, so compare shapes, not apparent lag).

**On a real phone**, the "Show keyboard measurements" command (`src/client/navigation/keyboard-probe.ts`) draws every
input to the keyboard height decision, the last keyboard travel and a ring of events on the device.

### A GPU emulator on Windows

An emulator run by Android Studio renders on the real GPU, so it shows what a frame looked like; drive it from WSL
with the Windows `adb.exe` (`.../Android/Sdk/platform-tools/adb.exe -s emulator-5556 ...`).

- Let Studio's Device Manager create and start the AVD (a hand-built one crash-looped SurfaceFlinger). Edit only
  `hw.keyboard=no` in its `config.ini` and restart it.
- After boot: `wm size 1440x3120`, `wm density 600`, `cmd overlay enable
  com.android.internal.systemui.navbar.threebutton`, and `settings put secure stylus_handwriting_enabled 0` -- **the
  emulator's mouse is a stylus**, so otherwise Gboard opens handwriting with a zero-height inset that looks exactly
  like a broken plugin. `dumpsys window displays | grep "type=ime"` tells them apart.
- A Play image may refuse adb until its debugging prompt is accepted; killing the Windows adb server can clear it, but
  restart it with `adb.exe -a nodaemon server start` in the background.
- To measure the composer against the keyboard: give `.ui-phone-row` a flat red background over CDP, `screenrecord`,
  take real timestamps with `ffprobe` (the container's rate is wrong), split frames with `ffmpeg -fps_mode
  passthrough`; per frame the keyboard's top edge against the red band is the lag in pixels.

`@capacitor/keyboard` cannot be installed: its `DISPATCH_MODE_STOP` callback stops inset animation dispatch to every
other listener.

## Release and install

`npm test` before tagging a release. Test installer changes with this checkout's installer against this checkout,
never by pushing `main` (docs/DEPLOYMENT.md, Release; a sandbox still shares the tailnet, and auth commands without its
`CONDUIT_DATA_ROOT` touch the real auth store):

```bash
# repository root
scripts/try-install.sh --sandbox     # --build rebuilds the client first
conduit-server-sandbox uninstall
```
