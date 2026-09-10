# Upward scroll blank viewport — investigation handoff

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).

## Symptom (user report)

> Sometimes when scrolling upwards, this happens, it is fixed when i scroll back down for a touch.

Screenshot: `screenshot.png` in this same folder (copied from incident attachment `004eb1eb-d777-4d96-8a68-193e51113f6a--image.png`).

What the screenshot shows:

* Header `conduit / Proxying ChatGPT Web to Conduit` and left nav intact.
* Center viewport is solid empty dark from top to ~75% height.
* One faint `11:19 am` timestamp + expand chevron mid-viewport survives.
* Bottom edge shows a clipped assistant line `2. Retain vs delete web conversations...` peeking above the composer.
* Composer `Send a message... / Muse Spark 1.3 Free high / Assistant / Ready` intact.
* Round `↓ Scroll to latest` button visible at right above composer.

Interpretation: transcript virtualization hiding in-viewport content, not missing chat data or failed load. Chrome + timestamps + bottom fragment painted, middle blank, `↓` visible.

`↓` visible means `following() == false` in `transcript.tsx` — app correctly thinks user scrolled up.

## Identities and paths (precise)

Incident chat (this diagnosis chat):

* `chat_id = f44563aa-0cd7-4335-8e22-4b5242da0ed2`
* `title = Investigating Upward Scrolling Issue`
* `templateId = runtime`, `templateVersion = 1`
* `runtime.kind = conduit_profile`, `installationId = conduit-pinned`, `binaryVersion = 0.84.1`, `profileId = runtime`, `profileVersion = 1`
* `piSessionFile = /home/jask/Conduit/data/pi/sessions/--home-jask-Conduit-data-chat-files--/2026-09-08T01-38-54-122Z_01a07eab-0c2a-7393-974e-3983050aaa40.jsonl`
* source from `data/sessions.json`

Affected chat (screenshot title `Proxying ChatGPT Web to Conduit`):

* `chat_id = 9e806ec3-575c-4d76-aa6f-2a9aa8ed586a`
* `title = Proxying ChatGPT Web to Conduit`
* `projectId = project_d63f103c-5e28-44cb-ac44-5320e571fe97`
* `templateId = assistant`, `templateVersion = 9`
* `runtime.profileId = assistant`, `profileVersion = 9`, `binaryVersion = 0.84.1`, `installationId = conduit-pinned`
* `modelThinkingLevels: opencode/muse-spark-1.3-contributor-free = high` — matches footer `Muse Spark 1.3 Free high Assistant`
* `piSessionFile = /home/jask/Conduit/data/pi/model-profiles/brave-search/sessions/--home-jask-Conduit--/2026-09-08T00-28-13-102Z_01a07e6a-55ae-7718-84fe-bde6a9772a8c.jsonl`

Do NOT treat as version mismatch or ownership mismatch. Both report `0.84.1 / conduit-pinned`; they differ only by profile `runtime v1` vs `assistant v9`. No evidence of version mismatch was found.

Default renderer:

* `data/preferences.json`: `"markdownRenderer": "incremark"`
* `conduit-web/src/client/chat/markdown-settings.ts`: `MARKDOWN_RENDERER_DEFAULT = "incremark"`

## Code paths inspected (read-only)

* `conduit-web/src/client/chat/transcript.tsx` — `Transcript`, `following` signal, `mountTranscriptVisibility`, `mountTranscriptPanelMotion`, inertial tail-follow (`advanceTailFollow`, `decideTailScroll`), `scrollBottom`, `loadEarlier`, `claimUserScroll`, scroll/wheel/touch/pointer/key handlers.
* `conduit-web/src/client/chat/transcript-visibility.ts` — the virtualizer:
  * `IntersectionObserver(root: viewport, rootMargin: 120px)` is the only thing that runs while scrolling — `show()` / `hide()` via `data-transcript-visibility="hidden"`
  * `ResizeObserver` records `contain-intrinsic-block-size / contain-intrinsic-inline-size` placeholders
  * `MutationObserver` keeps managed set in step; `measurePass()` only for explicit refreshes
  * `syncMembership()`: for Incremark virtualizes individual `.chat-markdown > .incremark > *` blocks, not whole rows; non-Incremark rows virtualize whole `[data-slot="message-scroller-item"]`
  * `holdRefreshing()` flag suppresses tail-follow resize handling for 2 frames after visibility change
  * `activeIds` gate: `if (activeIds.size) return;` in `visibilityObserver` — panel motion freezes virtualization
* `conduit-web/src/client/chat/transcript-motion.ts` — panel-motion translate/width preview, anchor preservation
* `conduit-web/src/client/chat/transcript-tail-follow.ts` — `decideTailScroll`, `advanceTailFollow`, `usedMaxScrollTop`, `TAIL_NEAR_LATEST_PX=80`, `TAIL_REJOIN_PX=8`
* `conduit-web/src/client/chat/transcript-anchor.ts` — `capture/restoreTranscriptAnchor`
* `conduit-web/src/client/styles.css:178-179,988-989`:
  ```css
  [data-slot="message-scroller-item"] { content-visibility: visible; }
  [data-transcript-visibility="hidden"] { content-visibility: hidden; }
  ```
  plus comment that assistant column must be definite width because virtualized blocks contribute zero intrinsic inline size.

## Why “scroll down a touch fixes it”

For Incremark, message chrome (`<time>`, bubble, actions) stays painted while inner markdown blocks stay `content-visibility:hidden`. That matches `11:19 am` visible but bubble body blank.

Upward scroll moves older blocks into view from the top. If those blocks are still marked `hidden` with stale intrinsic placeholders, the visible area paints blank. A small downward scroll re-fires the `IntersectionObserver`, `show()` removes the attribute, `holdRefreshing()` settles, content paints.

Three un-distinguished hypotheses (needs live DOM to separate):

1. `visibilityObserver` early-return while `activeIds.size > 0` (panel-motion gate) missing its `end` event → stuck frozen, never reveals until next refresh.
2. `measurePass()` classifying with stale placeholder rects vs `viewportRect +/- OVERSCAN_PX` → visible blocks misclassified as outside band.
3. `syncMembership()` vs observer race leaving a top-entering block observed but never intersected until next scroll tick.

Needed live evidence: during repro, inspect blank blocks for `data-transcript-visibility="hidden"` + inline `contain-intrinsic-block-size` / `contain-intrinsic-inline-size` values, and whether `IntersectionObserver` callback fires on upward scroll vs only on downward nudge. Check console/harness `transcript-scroll` metrics (`owner: typewriter-tail-inertial`).

## User recovery (no state change, no fix applied)

* Keep workaround: nudge down, or tap `↓ Scroll to latest` then scroll back up.
* Reload if stuck; no history loss expected — paint skipping, not transcript loss.
* No deletion, move, or migration proposed. This is data-cleanup-free. Do not delete either chat ID above unless user names exact target and confirms in-chat; state what would be removed and that it is unrecoverable.

## Smallest proposed dev change (to examine, NOT applied)

Audit `transcript-visibility.ts` upward-reveal path — ensure scroll-end forces `show()` for rects intersecting `viewport +/- OVERSCAN_PX` even if last `IntersectionObserver` batch was coalesced/skipped, and log `activeIds` gate hits during scroll. Consider asserting in-viewport blocks can never remain `hidden` after scroll idle.

## Repro sketch for implementation agent

1. Open affected long assistant chat `9e806ec3-575c-4d76-aa6f-2a9aa8ed586a` (`Proxying ChatGPT Web to Conduit`) with default `incremark` renderer.
2. Scroll up briskly past several settled markdown blocks.
3. Observe large blank viewport with timestamps surviving; small scroll down repaints.
4. Inspect DOM: `thread.querySelectorAll('[data-transcript-visibility="hidden"]')`, their `getBoundingClientRect()` vs `viewport.getBoundingClientRect()`, and `viewport.scrollTop / scrollHeight / clientHeight`.

## Files in this handoff

* `screenshot.png` — copy of user screenshot
* `report.md` — this file (full explanation + summary)

Original attachment source (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/004eb1eb-d777-4d96-8a68-193e51113f6a--image.png`
