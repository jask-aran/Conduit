# "Retrying" status masks 429 errors; trace hides them until interrupt — bug report handoff

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).

## Symptom (user wording)

> This generation reads 'retrying', only resetting to waiting for model or other status once the next tool call arrived. I assume there was some problem during reasoning/thinking, but tis not user visible, the error card that we alreayd have should be embedded in the reasoning trace so we can see when it happened and the recovery. Once i manually interrupt (second image), i can see the errors, but interestingly they are openai errors assumedly from search tool.

Screenshots in this same folder:

* `screenshot-1-retrying.png` (composer footer `Retrying`, trace shows reads Complete + thinking text, no error inline)
* `screenshot-2-after-interrupt.png` (after manual interrupt, footer `Interrupted · Ready`, trace now shows two red `Request failed` cards with `OpenAI API error (429) rate_limit_exceeded ... Upstream request failed: [rate_limit_exceeded]`, timed `08 Sept 2026, 04:46:34 pm AEST` and `04:48:44 pm AEST`)

Titles/header in screenshots: `Mersen AU/NZ Pricing & Discount Restructure context received and verified`.

## Chat identified (live at investigation time)

* `chat_id = e3152b4e-7e2b-4be5-8cea-c71c4933863d`
* `title = Mersen AU/NZ Pricing & Discount Restructure context received and verified`
* `projectId = project_ee2f106f-cdfc-46db-88bb-881b8d2ae22a` (`NHP`, `kind project`)
* `templateId = assistant v9`, `runtime.profileId = assistant v9`, `binaryVersion = 0.84.1`, `installationId = conduit-pinned`
* `modelThinkingLevels`: `opencode/muse-spark-1.3-contributor-free: high`, `openrouter/meta/muse-spark-1.3-contributor: high`
* `piSessionFile = /home/jask/Conduit/data/pi/model-profiles/brave-search/sessions/--home-jask-Conduit-data-chat-files-nhp--/2026-09-08T06-05-41-808Z_01a07f9f-4e30-7e9b-ac09-6c0ba2814441.jsonl` (57 JSONL lines)
* At 16:56 UTC read: `unread = true`, `updatedAt = 2026-09-08T06:56:25.058Z`, `lastMessageAt = 06:56:25.060Z` (user's `Keep Going` at `06:50:22Z` had since resumed; a live `pi` process was running). The sibling `Mersen Item Margin Simulation (76df95d2...)` is `unread=false` and not involved.

Match evidence: tool names in screenshots (`read .../attachments/1f06c9c7-...`, `.../93b7b70f-...`, `bash ...mean...net2min...`, `bash ...Price...Purchase Cost Adj...Acceptable Discount...`) match `toolResult` entries in that JSONL; error card text matches three persisted assistant messages with `stopReason:error` verbatim.

## What actually happened (session-file evidence, AEST = UTC+10)

Three persisted `role:assistant, stopReason:error, errorMessage: OpenAI API error (429) rate_limit_exceeded ... Console: Upstream request failed` messages:

| # | msg id | file ts (UTC) | AEST | position in turn sequence |
|---|--------|---------------|------|---------------------------|
| 1 | `b0dc9231` | 06:29:34 | 16:29 | after `toolResult bash` (build xlsx saved), before thinking `Verifying spreadsheet formulas...` |
| 2 | `cdbbc23a` | 06:46:34 | 16:46 | after `toolResult read` (image), before thinking `Reorganizing table layout...` — matches error card 1 in screenshot 2 |
| 3 | `4a29cd22` | 06:48:44 | 16:48 | after `toolResult bash` (AU clean 140/193), before thinking `Analyzing workbook validation...` — matches error card 2 in screenshot 2 |

So the failures are **model-request 429s between tool results and the next thinking/model block** — not search-tool errors. The `provider: opencode`, `model: muse-spark-1.3-contributor-free`, `api: openai-responses` on the persisted messages confirms the model path. There is no per-tool error in the JSONL; every `toolResult` is success text. "Assumedly from search tool" is refuted by the evidence (no search tool call/result surrounds the errors; neighbours are `read`/`bash` success results).

Recovery is also in the file: each error message is immediately followed by a fresh assistant `thinking` message and the turn continues (retried request succeeded). That is the auto-retry succeeding — the very thing the footer reports.

## Why the UI showed "Retrying" with no visible error (two mechanisms)

### 1. Footer "Retrying" is the auto-retry flag, and it is sticky by design

* `conduit-web/src/activity.js`: `auto_retry_start` sets `record.retrying=true, retry={attempt,maxAttempts,delayMs,errorMessage}`; only `auto_retry_end` clears it. `deriveCoarseActivity` ranks `retrying` above `working`. `deriveFineActivity` shows `Retrying [in Ns] [· attempt a/m]` while `coarse==="retrying" || retry` — ahead of thinking/responding/tool/starting.
* Detail (`retry attempt N`, delay) is captured into `activityDetail` but `composer.tsx` footer renders only the coarse `Retrying` label; the attempt/error text is not surfaced next to it.
* A 429 with `retryAfter`/backoff therefore parks the footer on `Retrying` for the whole backoff, then flips to `Waiting for model` / `Running <tool>` only when the retried request streams the next block. That matches "only resetting once the next tool call arrived". Not a stuck status — but the *reason* (429, attempt, wait) is invisible.

### 2. The trace cannot show a mid-turn error while the turn is live — and non-final errors are dropped even after settle

* Live projection `liveRows()` in `conduit-web/src/client/turn-rows.ts` builds trace segments only from `thinking`/`text:interim`/`toolCall` blocks plus a **terminal** error (`generation.status==="failed" && assistant.stopReason==="error" && is-last`). A recovered 429 never fails the generation, so no error segment is ever projected while streaming.
* Persisted projection `buildTurnRows()` *does* have an inline path — `TraceSegment {kind:"error"}` rendered by `TraceError` in `turn-trace.tsx` (red `Request failed` card with model/provider/profile + timestamp + `<pre>errorMessage</pre>`; header preview also shows `Request failed · ...`). BUT it only emits `if (assistant.stopReason === "error" && assistant !== finalAssistant)` — i.e. **non-final** errors only. A non-final error that ends up as the turn's final assistant is instead classified into `answerAssistants` and rendered as the bottom answer card, not inline at its chronological position.
* Net effect for the reported turn: during the retry the trace shows reads Complete + thinking with no error (screenshot 1); the error cards exist in persisted messages but are not projected inline until the turn settles AND the error is non-final. The manual interrupt settled the generation (`stop:aborted` msg `ff4c957a`, footer `Interrupted · Ready`), the checkpoint reloaded detail (`active-chat.ts: session_checkpoint` → `applyDetail`), and the previously-hidden non-final errors projected into the trace (screenshot 2).

So the user's proposal is correct in spirit: the existing error card exists (`turn-trace.tsx: TraceError`, `transcript.tsx: assistant-error`) but the live path has no chronological error slot.

## Repro

1. Open chat `e3152b4e...` (NHP project), session file above. Scroll the turn with the two 16:46/16:48 AEST error cards (post-interrupt state shows them inline).
2. Send `Keep Going`-style prompt on a rate-limited free model; when a mid-turn 429 hits, footer sticks on `Retrying` with no inline trace entry; next tool call flips footer.
3. Interrupt mid-retry → errors appear inline after settle. (Do not need to reproduce the 429 itself; the projection gap is deterministic from the JSONL: any `stopReason:error` non-terminal assistant message is invisible live.)

## Smallest fix directions (NOT applied — for implementation agent)

1. Live trace: project a chronological error segment for failed assistant blocks mid-generation (reuse `TraceError`), not only terminal failure. Source: `generation.assistantMessages[]` with `stopReason==="error"` in `liveRows()`/`buildLiveAnswerRow()` in `turn-rows.ts`; event path `assistant_message_completed` with `stopReason: error` in `live-events.ts:normalizeLiveEvent`.
2. Persisted trace: reconsider `assistant !== finalAssistant` gate in `buildTurnRows()` — a final error currently renders only as the answer card; a mid-turn error followed only by thinking (no more tools) can be final-yet-chronological. Either always emit the inline segment AND keep the answer card, or emit inline whenever a later thinking/tool segment exists.
3. Footer: surface retry detail already in state — `Retrying · attempt a/m · in Ns · 429 rate_limit_exceeded` (data in `record.retry`/`activityDetail`), so "Retrying" is no longer opaque. Keep `deriveFineActivity` precedence; just render the parts it already builds.
4. Verify: trigger/seed a mid-turn 429, watch error card appear inline at its position with timestamp while footer shows attempt + wait; recovery thinking/tools append after it; interrupt path unchanged; no duplicate cards after settle (live segment ↔ persisted `error:<id>` keyed reconciliation).

## User recovery (no state change)

No data deletion proposed. The errors were transient 429s, all three recovered (turn continued after each). If it recurs: wait out the backoff (footer `Retrying` is working-as-designed activity, not a hang) or interrupt and resend; free-tier `muse-spark-1.3-contributor-free` 429s are upstream rate limits, not Conduit data loss. Do not delete chat `e3152b4e...` — it is the live working chat, not disposable.

## Files in this handoff

* `screenshot-1-retrying.png` — footer `Retrying`, no inline error
* `screenshot-2-after-interrupt.png` — after interrupt, two 429 error cards inline
* `retrying-status-masks-errors.md` — this file

Original attachments (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/fc53ce73-657a-475e-9db0-80c6ed186963--image.png`, `.../ab68f9cf-bde7-4094-a780-51b3ef554032--image.png`
Key paths: `conduit-web/src/activity.js` (`auto_retry_start/end`, `deriveCoarseActivity`, `deriveFineActivity`), `conduit-web/src/pi-manager.js` (event publish), `conduit-web/src/pi-rpc-adapter.js:70-80` (retry mapping), `conduit-web/src/client/api/live-events.ts` (retry/message normalization), `conduit-web/src/client/turn-rows.ts` (`liveRows`, `buildTurnRows` error gate), `conduit-web/src/client/chat/turn-trace.tsx` (`TraceError`), `conduit-web/src/client/chat/transcript.tsx` (`assistant-error`), `conduit-web/src/client/state/active-generation-store.js`, `conduit-web/src/client/state/active-chat.ts` (checkpoint reload)
Session evidence: `/home/jask/Conduit/data/pi/model-profiles/brave-search/sessions/--home-jask-Conduit-data-chat-files-nhp--/2026-09-08T06-05-41-808Z_01a07f9f-4e30-7e9b-ac09-6c0ba2814441.jsonl` msgs `b0dc9231`, `cdbbc23a`, `4a29cd22` (+ neighbours `fbea96fd/265cb2fa`, `394bda0c/4cb4bc5d`, `f5f1e7d6/ff4c957a`)
