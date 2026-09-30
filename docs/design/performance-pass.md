# Performance pass: targets for investigation

Seeded 2026-09-29 from what turned up while building the panes (stage 6,
`panes-and-rail.md`). These are observations and suspicions, not diagnoses:
each target says what was seen, how it was seen, and where to start looking.
The probes were headless Chromium (Playwright) against the local server on
:4310, sampling once per animation frame; numbers are single runs on the dev
box unless noted.

**The budget is 6.94ms a frame (144Hz), everywhere**: every main-thread task
during an interaction -- a drag, a stream, a keystroke, a scroll -- should
finish inside it at full speed. Measure it per task from a trace (CDP
`Tracing` with `devtools.timeline`, the renderer main thread's
`ThreadControllerImpl::RunTask` durations), not from rAF gaps: headless
Chromium paints at 60Hz, so a 12ms frame looks the same as a 5ms one.

Before and after each change, run the regression cover for the panes
(`docs/testing.md`, "Panes smoke"): `node --test test/file-tabs.test.js` and
`npm run smoke:panes -- --project <a place whose page lists files>`.

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

**Likely cause (2026-09-30).** `readWorkspaceVersion`
(`src/workspace-inspector.js`, `GET /v0/projects/:id/workspace/version`)
starts `fs.watch(root, { recursive: true })`. On Linux, Node builds a
recursive watch by walking the whole tree synchronously: on this checkout
(21,853 directories, `node_modules` and `.git` included) the `watch()` call
alone blocks for 3.15s (measured standalone). Every request in flight waits
it out -- a cold open of `AGENTS.md` saw `/file` (6ms on its own) and
`/workspace/version` both finish 8.5s after the click. The watch closes after
`WORKSPACE_WATCH_IDLE_MS` (3s) without a poll, so it is paid again whenever
polling pauses for longer: the tab hidden, the last viewer or dock closed. The
first `/workspace/version` after a restart took 3.2s by curl; later ones
~28ms. Fixes to weigh: skip ignored trees (`node_modules`, `.git`, what
`.gitignore` names) by watching per directory, an async walk, a watcher that
does not walk (`@parcel/watcher`), or keeping the watch open for places still
in view rather than closing it after 3s.

**Fixed (2026-09-30).** The recursive watch now starts on a worker thread
(`watchOffThread` in `src/workspace-inspector.js`); a place's first
`/workspace/version` waits for it to be live, and it stays open 60s after the
last poll rather than 3s. Measured straight after a restart: `/file` requests
made while the Conduit checkout's watch was still walking answered in 6-9ms,
and a cold open of `AGENTS.md` into a pane reached its editor in 234ms (was
3.9-8.5s). The walk still costs a core for ~3s and holds a watch on every
directory, `node_modules` included; skipping ignored trees is the next step if
that matters.

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

**Measured (2026-09-30), with target 6.** Under a 4× CPU slowdown with two
chats open and one streaming a real turn, frames dropped (7-20 of ~240 over
33ms in 4s) and deleting the `:has()` rules removed nearly all of it (0-1): the
streaming half of this report is most likely target 6. Dragging the pane
divider in the same setup cost the same with or without the rules: ~1.9s of
main-thread work, ~600-680ms style and 210-220 layouts over 30 pointer moves
(~7 layouts per move), so the drag half is forced layout of its own -- the
per-frame measuring described below is the first suspect.

**Divider drag fixed (2026-09-30).** Three causes, in order of cost:

1. The effect that announces pane widths (`main.tsx`, on `paneWeights()`)
   fired on every frame of a drag and started a geometry motion of its own
   each time -- a new id, then begin and end -- so every open transcript
   measured, pinned and fully relaid out (anchor included) every frame, and
   ignored the drag's own changes under the stale id. It now stays quiet while
   a drag or ease has a motion open (`splitMotionOpen`).
2. The drag measured every pane (`besideWidth()`) straight after writing the
   new weights, and each transcript measured its own width in turn. The drag
   now announces the widths it worked out, and passes each pane's width in
   the event (`panes` in `PanelGeometryMotionDetail`), so transcripts do not
   read.
3. `workspace-resizing` on body set an inherited cursor and user-select,
   restyling the whole page at the drag's start and end (~6-7ms each). Both
   resize handles now keep their cursor by pointer capture.

Two chats side by side, 40 pointer moves, per-task trace:

| | Before | After |
| --- | --- | --- |
| Layouts / style recalcs over 30 moves | 210 / 526 | 40 / 130 |
| Worst task, full speed | 15.2ms | 7.8ms |
| Tasks over 6.94ms, full speed | 3 | 2 (the press, 7.8ms; the final relayout, 7.6ms) |
| Tasks over 6.94ms, CPU 4× slower | 57 | 49 |

Every frame of the drag itself is now inside the budget at full speed; the
press (the transcripts' one measure as the motion begins) and the last frame
(each transcript taking its new width) are just over. Under 4× slowdown
what is left is paint and layerize (~4-5ms each a frame) plus the thinking
orb's canvas, redrawn every frame (`fill`/`arc` in its rAF loop) -- a lead for
target 13 too.

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

## 6. One-shot motion rules make every DOM change pay for style (seen 2026-09-30)

**Seen.** With a file open in a pane, 40 arrow-key presses in its editor cost
~500-570ms of style recalculation (~12ms a key). Deleting every `:has()` rule
from the page took that to ~19-43ms; the same rules made no difference to
typing in the composer (a textarea's value is not a DOM change). Rule by rule
(20 keys each, ~21ms baseline):

| Rule (`styles.css`) | Recalc / 20 keys |
| --- | --- |
| `:root[data-route-motion="arriving"] :is(.chat-main, .chat-main :has([data-part="composer"])) > …` | 283ms |
| `:root[data-arrival="arriving"] :is(…, :is(.chat-main, .main-split) :has([data-part="composer"])) > …` | 255ms |
| `:root[data-route-motion="leaving"] …` (same shape) | 253ms |
| `:root[data-arrival="waiting"] …` (same shape) | 217ms |
| `.settings-dialog .settings-content [data-slot="field"]:has(> textarea)` | 149ms |
| each other `:has()` rule | ≤ 44ms |

The four motion rules cost this all the time, not only while their root
attribute is set: a `:has()` under a descendant combinator makes Chromium
re-check ancestors on every mutation beneath `.chat-main`/`.main-split`. The
settings rule costs it with no settings dialog open.

**Why it matters.** Any surface that mutates the DOM steadily inside a pane
pays it per change: CodeMirror on every cursor move or keystroke, and a
streaming transcript per rendered chunk. Measured on a real turn (below), it
is the main cost of streaming and the most likely cause of target 3.

**Streaming, measured (2026-09-30).** Real turns from Muse Spark 1.3
Contributor (`openrouter/meta/muse-spark-1.3-contributor`, thinking minimal)
on the Assistant profile, a ~1200-word answer with headings, lists, a table and
a code block, in 4s windows of requestAnimationFrame gaps plus CDP metrics:

| Setup | Style / 4s | Script / 4s | Frames over 33ms (of ~240) |
| --- | --- | --- | --- |
| One chat, full speed | 100-235ms | 170-190ms | 0 |
| Beside a second chat, full speed | 125 → 233 → 407ms as the answer grows | 90-305ms | 0 |
| Two chats, CPU 4× slower, rules in place | 330-1340ms | 800-890ms | 7-20 |
| Two chats, CPU 4× slower, every `:has()` rule deleted | 196-245ms | 290-335ms | 0-1 |

Style is the largest single cost of a streaming turn and grows with the
transcript while the rules are in place; without them it stays flat, although
that turn ran later with a longer transcript. The Test profile
(`test-stream`, plain paragraphs, 250 tokens/s) showed no difference with or
without the rules: plain text mutates far less DOM than real markdown, so use
a real turn to judge this target.

**Leads.** Mark the parts that fade once, in JS, when arrival or route motion
starts (an attribute on each outermost non-composer child), so the rules need
no `:has()`; or scope them to a class set only for the 300ms they run. Give
wide settings fields `data-wide` (the rule's other half already reads it) and
drop `:has(> textarea)`. Probe: the arrow-key loop above with CDP
`Performance.getMetrics` (`RecalcStyleDuration`).

**Fixed (2026-09-30).** The four motion rules moved to `motion-rules.ts`,
which adds them as a style element only while `data-arrival` or
`data-route-motion` is on the root (the first open's fade was checked: the
first frame is hidden, the fade runs, the element is gone after). The settings
selector's `:has(> textarea)` half matched nothing -- no field holds a
textarea -- and went. After:

| | Before | After | Every `:has()` deleted |
| --- | --- | --- | --- |
| 40 arrow keys in a file editor, style | 500-570ms | 103ms | 19-43ms |
| Real turn, two chats, CPU 4× slower, style / 4s | 330-1340ms | 264-342ms | 196-245ms |
| Same, frames over 33ms (of ~240) | 7-20 | 1 | 0-1 |

What remains is spread across the other ~30 `:has()` rules, none over ~44ms
on its own in the editor test.

## 7. A file viewer's first open is a serial chain (seen 2026-09-30)

**Seen.** Cold open of `AGENTS.md` into a pane: editor, languages and viewer
chunks at 64-78ms, then `/file` and `/workspace/version` (target 1's stall),
and only once the file had arrived did `workspace-markdown` and two more
chunks start loading (8635ms). The column itself did not exist until then, so
focus had nothing to land on for ~4s (`focusColumn` now waits up to 6s).

**Leads.** Start the renderer's chunk (markdown, by the file's extension) in
parallel with the fetch, as `loadWorkspaceEditor()` already is for text.
Render the column's frame and header before its contents so focus, the tab
strip and folding settle at once.

## 8. Media files are asked for as text first (seen 2026-09-30)

**Seen.** Every image, PDF, audio or video opened in a viewer is first
requested as text (`GET /file?path=…`), answered `400 file_not_text`, then
fetched again as metadata and inline. That is one wasted round trip per open,
and a console error each time (the panes smoke tolerates it).

**Leads.** `workspace-file-slot.tsx` `load()`: when `fallbackKind(path)` says
image/pdf/audio/video, go straight to `?metadata=1` and the inline URL; keep
the text-first path for unknown extensions.

## 9. Two pollers per place with a viewer open (seen 2026-09-30)

**Seen.** With the dock's Files open, `/workspace/version` is polled ~3 times
in 6s; opening a file viewer on the same place takes it to 7-8, as the viewer
runs its own 1.5s probe (`workspace-file-viewer.tsx`) beside
`workspace-poll.ts`'s. Both stop while the tab is hidden (good), which is also
what lets target 1's watch close and be re-walked on return.

**Leads.** One poller per place, shared by the dock and every viewer showing
it, handing out `changedPaths` to each subscriber.

## 10. Scrolling up a long transcript forces layout per frame (seen 2026-09-30)

**Seen.** The first scroll up through a long chat's history (40 wheel steps
of 400px over ~2.4s) cost ~830-880ms of main-thread work: ~210-240ms style,
~57ms layout, ~150ms script, ~520ms "(program)" (native: paint, raster,
compositing). A CPU profile put ~150ms in `getBoundingClientRect` from two
callers:

- `measurePass` in `chat/transcript-visibility.ts` (~75ms): each frame it
  reads the rect of every virtualised block, then writes intrinsic sizes and
  shown/hidden attributes, and schedules another frame whenever a block was
  revealed. So a scroll that reveals blocks re-measures the whole transcript
  every frame, and each pass's writes make the next pass's reads force a
  layout.
- The anchor restore after `loadOlder()` in `chat/transcript.tsx`
  (`restoreAnchor`, ~70ms): it reads the anchor's rect straight after older
  messages are inserted. That forced layout is inherent, but it lands in the
  same frame as the insertion.

Scrolling back over blocks already drawn is cheap (~19ms of style for 24
steps without `:has()` rules, ~40-55ms with them: target 6's rules add ~2×
here too, spread across many of them rather than one).

**Leads.** Let an `IntersectionObserver` (margin = the overscan) decide shown
and hidden, and the ResizeObservers the module already holds keep intrinsic
sizes current, so no pass has to read every block. Failing that, measure only
blocks near the band. For history loads, restore the anchor with
`overflow-anchor` or in the frame after insertion. Probe: wheel loop plus CDP
`Profiler` with callers of `getBoundingClientRect` (minified positions map to
source via the bundle; CDP line numbers are 0-based).

**Fixed in part (2026-09-30).** Traced per task, the full measuring pass
(`refresh` → `measurePass`) was in nearly every frame over budget, from two
triggers that were not what it exists for:

- `scrollend`, which fires between wheel notches, ran it to repair missed
  upward intersections. It now re-observes every managed block instead -- an
  IntersectionObserver reports a new target's current state, computed in the
  frame's own intersection step, with no rect read.
- The mutation watcher took any `data-collapsed` change as a deliberate fold:
  user-message text rewrites the attribute to the same value, and settles its
  first fold verdict as history loads. It now runs the pass only for a real
  change inside a hidden block, the one place the observers cannot see; a
  reader's toggle already re-measures through `CODE_BLOCK_TOGGLE_EVENT`.

Long chat, 40 wheel steps each way, per-task trace (two runs each):

| | Before | After |
| --- | --- | --- |
| Scroll back down: tasks over 6.94ms | 21 (worst 10.0ms) | 0 (worst 6.3-6.9ms) |
| First scroll up: tasks over 6.94ms | 21 (worst 19.3ms) | 8-12 (worst ~30ms) |

No block was left hidden in view after fast, slow or flick scrolls either
way. What remains over budget scrolling up is each page of older history:
rendered in one task (~10-15ms of script) and laid out when its anchor is
restored (~6-11ms), ~20-30ms together. Restoring the anchor only in the next
frame was tried and was worse (worst 40ms): until then the new page sits in
view and the visibility observer reveals, then hides, its blocks. Next step:
render a history page across frames, or insert it hidden with estimated
sizes -- target 2's territory.

**Tried and reverted (2026-09-30): drawing a history page a row a frame.**
The page's data went in as before; the transcript held back the rows above
the first one it had drawn and revealed them one at a time, restoring the
anchor after each, until ~4ms of the frame had gone. It was worse on every
count: 35-39 tasks over 6.94ms on the first scroll up (from 8-12, worst 48ms),
and the row in view moved 21px on two of four loads. One row, drawn and laid
out, took 16-20ms on its own: each reveal relaid the whole thread above the
anchor and rendered that row's markdown in full, so rows are too coarse a unit
to spread. A page loaded in one go costs ~10-15ms of script (building its
rows and rendering their markdown) plus ~6-11ms of layout. To get under the
budget both halves have to shrink, and the two ways to do that are:

- **Layout:** insert a page's rows already virtualised -- `content-visibility`
  with an estimated `contain-intrinsic-size` -- since they land above the
  viewport and are not painted; the browser's own scroll anchoring then
  corrects as each is first shown at its real size.
- **Script:** render a history row's markdown only when it nears the
  viewport (the visibility observer already knows), drawing an
  estimated-height shell until then.

## 11. Startup long tasks (seen 2026-09-30)

Mostly target 12 (the icon manifest). A warm load of a long chat: first paint at 40-48ms, first contentful paint at
660-700ms, then long tasks of ~190ms, ~53ms and ~67ms within the first 550ms.
They were not broken down, but most likely hold the shell's first render and
the transcript's first passes (target 2). Profile the first second of a load
with the same CDP approach.

## 12. A file-icon manifest generated on every load (seen 2026-09-30)

**Seen.** A CPU profile of a warm chat load (840ms of non-idle main thread in
the first ~2.5s) put ~185ms in one place: `generateManifest()` from
`material-icon-theme`, run at module load by
`workspace/material-file-icons.ts` inside the lazy `file-type-icon` chunk
(1.25MB, 238KB gzipped), which a chat page loads too. It builds the theme's
whole manifest to answer "which SVG for this name or extension". This is most
of the ~190-210ms long task at ~200ms after navigation (target 11).

**Leads.** Generate the lookup at build time -- file names, extensions and
folder names to asset names, with the `*.dax` association -- as a small JSON
or module, and drop `material-icon-theme`'s generator from the client. Find
why a chat page loads the chunk at all (the attachment strip, the sidebar or
the dock) and whether it could wait until an icon is drawn.

## 13. Work continues after a turn ends (seen 2026-09-30)

**Seen.** After a real turn had settled (no Stop button), a chat left open
did ~200-270ms of main-thread work per 4s (40-70ms of it style), where an idle
chat loaded fresh did ~8ms per 3s. Not traced.

**Leads.** A CSS animation or timer still running after settling (the
thinking orb, a live dot, the harness mark's lively state, relative times),
or the transcript's deferred passes; Chrome's Performance panel or the CDP
Animation domain will name it.

**Cause and fix (2026-09-30).** The thinking orb: DESIGN.md has a settled
turn's orb keep turning (Done, one turn in ~12s; Interrupted and Failed
sputtering), and each orb ran its own requestAnimationFrame loop drawing
every frame -- two chats with three settled turns in view were three loops at
the display's rate, and each draw also rewrote both canvases' opacity (a style
recalc). Now (`chat/thinking-orb.tsx`):

- every orb shares one loop, which runs only while one plays;
- a settled orb draws 15 times a second (30 sputtering; `settledOrbRate`) --
  at 20px its turn moves ~0.3px a step, which does not show;
- with only throttled orbs playing the loop sleeps until the next draw is
  due, since merely asking for a frame makes Chromium run a whole one
  (style, intersection observers, commit);
- opacity is written only when it changes.

A live orb still draws every frame (checked on a Test profile turn: one orb,
60 draws a second headless). Two chats idle, three settled orbs in view:

| | Before | After |
| --- | --- | --- |
| Frames asked for in 2s | 363 | 30 |
| Orb draws in 2s | ~360 | 90 |
| Main-thread work in 4s | ~190ms | ~111ms |
| Same, CPU 4× slower | ~734ms | ~413ms |

What remains idle (~28ms a second) is the orbs' own draws and the frame
commit around them, each well inside the budget.

## 14. Measured and fine (2026-09-30)

So the pass need not look again: scrolling a long file (30 wheel steps: 1
layout, 10ms of style), a tab switch (~75ms of work), header folding (no
attribute writes while scrolling or moving the cursor), the file-drag pill
(0.1-1.5ms a dragover after the transform fix), an idle viewer (33ms of
work in 3s), typing in the composer (~16ms of style for 25 characters, with
or without target 6's rules), toggling the sidebar (~70ms of work for two
toggles), and an idle chat (8ms of work in 3s). Switching chats, opening a
chat beside and closing a pane each cost ~160-230ms of main-thread work,
which would be worth a second look after targets 2 and 6.
