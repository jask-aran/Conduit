# Performance pass: targets for investigation

Seeded 2026-09-29 from what turned up while building the panes (stage 6,
`panes-and-rail.md`). These are observations and suspicions, not diagnoses:
each target says what was seen, how it was seen, and where to start looking.
The probes were headless Chromium (Playwright) against the local server on
:4310, sampling once per animation frame; numbers are single runs on the dev
box unless noted.

## 1. The server's event loop stalls for ~3.5s

**Seen.** On cold page loads, every `/v0/` request issued in the first ~500ms
-- `/v0/server`, `/v0/preferences`, `/v0/harnesses`, `/v0/chats`,
`/v0/sessions/:id`, `/v0/ptys`, `/workspace/version`, `/diff?history=0`,
`/file` -- finished together ~3.4-3.8s later. Two of four cold loads showed
it; a warm reload straight after did not (the same requests finished in
~300ms). One stalled run was straight after `start-conduit.sh restart`, one
was not.

**Why it matters.** It is almost certainly the "pane B took ~10s to show its
chat" report, and it pushes the first-open reveal onto its 2.5s fallback, so
panes appear still loading.

**Leads.** No `execSync`/`spawnSync`/`execFileSync` in `src/server`, so
something else holds the loop: CPU-bound work (JSON of a large transcript or
catalogue, git status parsing), a synchronous fs walk, or discovery work run
on first request (`terminals.reconcile()` in `GET /v0/ptys`, harness discovery
behind `/v0/harnesses`, per-harness thread listing). Start with an event-loop
delay monitor (`perf_hooks.monitorEventLoopDelay`) and `--cpu-prof` around a
cold load.

## 2. Long transcripts render in passes, after being shown

**Seen.** A chat with a long history (~3400px of thread) grows in steps after
it mounts: thread height 1428 → 1421 → 1525, a pause of ~500-700ms, then
2689 → 3387. The first-open reveal now waits for panes to hold still for three
frames, but the pause is longer than that, so the later pass can land after
the fade: one run recorded a layout shift of 0.16 as visible blocks appeared
(`S0:DIV 0x0 → 404x394` etc.) ~500ms after reveal, and earlier runs showed
visible bubbles moving down ~104px under the fade.

**Leads.** `chat/transcript-visibility.ts` (virtualisation refresh scheduling,
`scheduleRefresh(true)` after motion / fonts ready / scrollend), the incremark
render path, and whatever makes the second pass idle-scheduled. Wanted: a
signal for "this transcript has finished its initial render" that the reveal
(and the swap/close crossfades, which today wait for `.thread` to exist) can
wait on.

## 3. Transcript "jelly" with several chats open

**Seen (user).** With two or more chats open side by side, under load (e.g.
while the app is updating), a moving pane edge leaves the composer tracking
correctly per frame while the transcript lags and wobbles left/right. Dragging
the dock is reported fine.

**Not reproduced.** Divider drags between two chats at 6× CPU throttle:
transcript and composer margins matched on every sampled frame, and the
transcript's virtualisation stays frozen during motion. The one real bug found
nearby (columns sliding past their gutter and snapping back) is fixed.

**Leads.** Which gesture it is (divider drag, pane open/close ease, layout
preset, sidebar toggle, window resize, or during streaming). In side-by-side
mode `chat/transcript-motion.ts` measures each pane with
`getBoundingClientRect()` per frame, and in its reflow branch writes width then
the next transcript reads -- forced layouts that multiply with each chat open.
If it is streaming, incremark re-rendering per token competing with layout is
the suspect.

## 4. The file viewer's lines change height after showing

**Seen.** A markdown file opened in a pane lays its lines out at 15px, then
~0.5s later at 19-24px as heading styles apply (`cm-line 643x15 → 643x24`),
and gutter elements shift with them. Visible after the first-open reveal.

**Leads.** CodeMirror's language/highlight extension loading lazily after the
first render; load it before the viewer is shown, or hold the viewer back
until it is ready.

## 5. Smaller items seen along the way

- The workspace rail rendered at 48px then 35px on first load (its styles
  arrive with the dock's lazy chunk). It is now inside the first-open reveal,
  which hides it; bundling its few rules with the shell would remove the cause.
- A chat opened live counts as loaded (`loadedId` set, presentation
  `opening_live`) before its messages arrive; anything that treats "loaded" as
  "ready to show" sees an empty transcript. Panes now withhold the transcript
  while opening, as pane A does.
- Moving a chat into another pane waits for its transcript to exist; in warm
  runs that was ~250-370ms after the click, of which ~130ms was loading and the
  rest rendering.
