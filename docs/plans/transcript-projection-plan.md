# One transcript, held once

> **Status (2026-10-06): mostly built; the remaining duplication is listed below.**

## Target

- The server states the transcript (`transcript_op`, numbered by the chat log)
  and both ends fold it with `src/transcript-fold.js`. Nothing else decides
  message identity, order, outcome or placement.
- Paint (`assistant_content`, `tool_activity`) draws the message in flight and
  owns nothing that has been stated.
- Each turn, live or settled, is held in one place per side, and nothing is read
  from disk that the reader will not use.

## What already holds

`readTranscript` on every adapter. Browser-minted `m_<uuid>` ids bound to
harness entries (`src/message-ids.js`). Ordered, numbered ops with resume and
reset (`src/server/chat-log.js`). Stated `answers`, `interim` and `turn.settle`
consumed by `client/turn-rows.ts` without inference.

## Rule for settle reconciliation

Settle must not re-render. A settled turn keeps its DOM: the same answer node,
the same disclosure open/closed state, no re-run of fades, no layout shift.
Reconciliation exists only to catch a genuine divergence, and it costs nothing
when there is none:

- The server compares the record against what its log stated for that turn and
  publishes **only** when they differ, as targeted ops for the rows that
  differ, never a window that replaces rows.
- A clean turn produces no message to the client and no extra disk read beyond
  the one the checkpoint already does.
- A divergence is logged server side, so it is a bug report, not a silent heal.

## Remaining work

Ordered by risk, smallest first. Each lists its regression gate.

1. **Done.** **Refused prompt keeps its bubble.** `active-chat.ts` `generation_limit`
   checks for the retired `user_` prefix; match the id the send minted instead.
   Remove the dead `message.pending` filter in `clearQueue`.
   *Gate:* none needed; confirm by hand.

2. **Done:** `ChatLog.reconcile` compares; windows only bind ids. **Settle sync is read and thrown away.** `server.js` publishes a
   `transcript_sync` window on every Pi checkpoint; the client drops any sync
   without `replace`. Replace it with the diff described above (server-side
   compare of the projection against the folded log, emitting ops only on
   mismatch). Stops logging non-replacing syncs. The stop and interrupt paths
   in `live-session-stream.js` also publish four non-replacing windows the
   client drops; their comments describe a heal that no longer happens. Their
   real effect is `messageIds.bind` inside `syncTranscript`, which must be kept
   (or moved into step 5) when the publish goes.
   *Gate:* `transcript-pipeline`, `transcript-sync`, `chat-log` tests, plus the
   settle-stability probe below.

3. **Done:** `currentSegment` in `turn-rows.ts`; paint never wrote into `messages()`, so the overlap was only the projection drawing a whole steered generation under its first prompt. **The client holds the live turn twice.** `message.open` adds a streaming row
   to `messages()` while `generationStore` builds the same message from paint,
   and `projectLiveTurn` swaps one for the other via `liveOwner`. Make the
   generation view the only live source of the in-flight message's body; the
   `messages()` row carries identity and placement only, and takes its body
   from `message.close`.
   Fixed with it: a steered message's answer drawn above it, and (Pi) a
   finished turn shown as still writing after Pi took the queued message,
   because Pi stated the old prompt's outcome only when the next answer opened.
   *Gate:* `turn-rows` (notably "keeps the answer display key across live and
   persisted projections"), `timeline-projection`, settle-stability probe.

4. **Client-side transcript decisions.** `runtime_exit` prunes streaming rows
   locally; send / interrupt / regenerate / fork roll back with
   `setMessages(previous)`, which can overwrite ops that arrived meanwhile, and
   regenerate cuts twice. The server states the exit as `message.close` /
   `message.drop`; failures remove only the row the client added, by id.
   `replaceMessages` keeps only rows the client itself added and not yet stated.
   *Gate:* `transcript-sync`, `transcript-pipeline`.

5. **Pi's id binding happens late.** `m_` ↔ `pi:<entryId>` is joined at
   checkpoint or sync time. Bind when Pi accepts the prompt where it says so,
   and keep the checkpoint join only as the fallback.
   *Gate:* `transcript-pipeline` queued and interrupt cases.

## Regression coverage

What is covered today is the data: the per-harness pipeline tests assert the
rows and their order, `turn-rows` asserts projection and display-key
stability, `transcript-fold` / `transcript-sync` / `chat-log` the ops and the
log. None of them sees the DOM, so none would catch a settle that rebuilds a
node, closes an open disclosure, replays the answer fade, or makes the action
row arrive twice.

`scripts/probes/settle-stability.mjs` (run from `conduit-web/` against the
served checkout, ~1 min, no model call) is the gate for every step that touches
the live or settle path. It drives the Test profile (`think`, `N tools`,
`approve`, `Nt` in the prompt) in headless Chromium and prints `ok`/`FAIL` per
scenario:

- `settle` -- thinking, two tools, long answer, trace opened mid-stream: the
  answer and trace keep their nodes, the trace stays open, the text is only
  extended, nothing is added, removed or moved for 2s after settle, one action
  row.
- `stop-answer` -- the same across a stop mid-answer.
- `deny-tool` -- the same across a dismissed approval.
- `queued`, `queued-tool` -- a message queued mid-answer (next turn) and mid-tools (joins the turn): no answer above its prompt, never queued and sent at once, no earlier turn still working, and the settled shape equals a reload's.

The word-fade unwrapping its spans and the action row replacing its
placeholder are expected after settle and are not counted, nor is the queued
card while it leaves. The Test profile ends a turn before taking a late
message, so the Pi-only stale-turn case is checked against a live Pi turn.
