# Conduit Rendering and State Architecture

**Target:** `jask-aran/Conduit` `main` at `c8257ad0206a68fb0453bcd2af61d7e90fa21eed`, all findings re-verified against that checkout on 2026-07-23 (file/line references below resolve against it)  
**Pi integration target:** Conduit packages `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` 0.80.6 (pinned in `conduit-web/package.json`; event shapes verified against the installed package's `.d.ts`)  
**Purpose:** Prescriptive implementation guidance for the Transcript and Live Response only. Broader application/server findings live in the companion `performance-code-review.md`.  
**Goal (owner decision, 2026-07-23):** reproduce Conduit's *current* in-use Live Response behaviour exactly, reimplemented on the structured domain model below. Interim text stays chronologically inside the Thinking Summary (as it does today); only the Generation's trailing text is the Answer. The **only** user-facing configuration is whether the Thinking Summary defaults to expanded or collapsed — there is no toggle for *where* interim text goes. See "Settled interim-text contract" below. This supersedes the earlier draft's "monotonic Answer Output" guardrail; the earlier idea of a per-user interim-text-location toggle is dropped.

## Executive decision

The Solid rewrite is a material improvement. Its initial bundle is healthy, state ownership is clearer than the React client, and the current streaming presentation is broadly the desired presentation. The next pass should preserve that UX while replacing the accumulated streaming heuristics with one structured live-response model.

The central architectural decision is:

> Preserve Pi's ordered assistant-message and content-block shapes at the Conduit server boundary. Treat the Thinking Summary and Answer Output as UI projections of that structure. Do not flatten Pi's stream into global strings and later infer its original structure from tool timing, transcript reloads, or component state.

This does **not** require a new durable snapshot store. The browser should reconnect to the same Conduit WebSocket and immediately resume the live generation. Because WebSockets do not replay messages missed while disconnected, the server must send the current in-memory live response when the socket attaches. Conduit already does this under the name `runtime_snapshot`; the required change is to make that resume payload structured and complete rather than a capped event replay plus one flattened text string.

The priorities are preserving Pi's structure, bounding streaming-render work, and bounding socket buffering. Component renaming or cleanup is useful only where it helps establish the new domain boundaries.

Note that preserving Pi's structure is what makes the settled interim-text UX *cheap*: with ordered blocks and `stopReason` in domain state, "which text is interim" is a deterministic function of the block tree. The current implementation reaches the same visual outcome through timestamp attachment, a "nearest preceding user message" search, and freezing streamed strings into messages at `tool_execution_start` (`active-chat.ts:388-418`) — heuristics this redesign deletes, not preserves.

## Migration status

- [x] **Slice 1 — normalized protocol and pure reducer fixtures.** Approved
  after compatibility-path regression testing. `pi-event-normalizer.js` assigns
  generation-local message identity and preserves block structure;
  `active-generation.js` supplies the sequenced pure reducer, Resume State
  replacement semantics, persisted-message reconstruction, and structural
  Interim Text classification. Raw Pi fixtures cover ordinary answers,
  thinking, sequential/parallel tools, narration before tools, multiple
  blocks, retry, stop, provider error, and reconnect prefixes. Nothing is
  connected to the live server/client path yet.
- [x] **Slice 2 — server Active Generation and Resume State.** Approved after
  live reconnect testing. `PiManager` feeds normalized Pi events
  through the shared reducer, keeps structured state independent of the capped
  compatibility ring, and returns `generation_resume` before the legacy
  `runtime_snapshot` on WebSocket attachment. The existing client continues to
  consume its compatibility events.
- [x] **Slice 3 — client Active Generation and existing visual projection.**
  Approved after live streaming, stop, regenerate, edit, reload, and
  navigation testing. The client projects the structured generation directly,
  suppresses persisted partials in its owner turn, and retains legacy events
  only for compatibility/persistence confirmation. Follow-up fixes normalize
  overlapping provider start/delta text, prevent resumed Thinking Summary
  duplication, apply the composer model/thinking selection to retries, and
  retain a chat-local thinking-level preference for each model.
- [ ] **Slice 4 — reconnect, batching, and backpressure.**
- [ ] **Slice 5 — bounded Markdown rendering.**
- [ ] **Slice 6 — compatibility-path removal.**

**Pi session compatibility rule.** Use Pi's `fork`/tree contract wherever it
is available in both the bundled and Host Pi versions. Conduit retains only
its stable chat identity and the Active Generation projection; it must not
maintain a parallel session-tree model. Verify the shared RPC contract against
the pinned packages before adding a Pi-dependent client behavior.

## Settled product terminology

Use these names consistently in product copy, components, types, tests, and future design discussion.

| Term | Meaning | Relationship to Pi |
|---|---|---|
| **Transcript** | The complete scrollable conversation surface above the composer. It contains persisted history and, while generating, the Live Response. | Conduit UI concept. It projects durable Pi session messages plus current live state. |
| **Generation** | One user-visible run from submission until completion, stop, failure, or terminal retry settlement. | Approximately Pi `agent_start` through terminal `agent_end`/settlement. It can contain multiple Pi turns. |
| **Live Response** | The currently generating portion of the Transcript. It contains the Thinking Summary and Answer Output. | Conduit UI projection of the active Generation. |
| **Pi Turn** | One model response and the tool executions caused by that response. If tool results return to the model, another Pi turn begins. | Pi domain concept. Do not use "turn" as a synonym for the entire Generation. |
| **Assistant Message** | One model-produced message within a Pi turn. | Native Pi message with ordered `content[]` and a terminal `stopReason`. |
| **Content Block** | One ordered item in an Assistant Message: `thinking`, `text`, or `toolCall`. | Native Pi shape. `contentIndex` identifies it within that assistant message while streaming. |
| **Thinking Summary** | Collapsed-by-default disclosure containing Thinking Blocks, Tool Call Cards, **and Interim Text segments** in chronological order. Its collapsed header shows a single-line preview plus the tool-call count. | Conduit UI projection, not a Pi object. |
| **Thinking Block** | Reasoning or reasoning-summary text exposed by the provider. | Native Pi `thinking` content block. "Reasoning Summary" is not the canonical block name because provider output may be raw thinking, summarized thinking, redacted content, or absent. |
| **Interim Text** | A Pi `text` block that turned out not to be the Generation's final text: tool activity follows it within the same Generation. Displayed chronologically inside the Thinking Summary between the Thinking Blocks and Tool Call Cards it sits among. | Native Pi `text` block, classified by Conduit using the structural rule below. Replaces the old `narration` concept, which reached the same UX via heuristics. |
| **Answer Output** | The visible response text outside the Thinking Summary: the Generation's *trailing* text, streamed eagerly. Until the Generation settles it is provisional — a later tool call reclassifies it as Interim Text. | Conduit projection over native Pi `text` blocks. |
| **Final Answer** | User-facing name for the Answer Output once the Generation settles. May span several Pi text blocks or Assistant Messages. | Conduit presentation concept, not necessarily one native terminal Assistant Message. |
| **Markdown Renderer** | Marked + KaTeX + sanitization + DOM reconciliation implementation. | Conduit implementation detail. Reserve "renderer" for this layer rather than the whole Transcript. |
| **Resume State** | Current in-memory Active Generation sent immediately when a browser WebSocket attaches or reattaches. | Conduit transport concept derived from Pi events. Replaces the ambiguous phrase "snapshot mechanic." |

Recommended component/type renames include `TurnTrace` → `ThinkingSummary`, its child union → `ThinkingBlockView | InterimTextView | ToolCallCardView`, and the current flattened live-stream state → `ActiveGeneration`/`LiveResponse`.

## Settled interim-text contract

The owner's requirement: **reproduce current Conduit behaviour exactly, implemented cleanly.** Interstitial text emitted before/after tool calls but before the final answer is displayed **chronologically within the thinking dropdown**, interleaved with Thinking Blocks and Tool Call Cards in Pi's native order — which is what `main` already shows via its `narration` path. There is no user setting for interim-text placement; the only Live Response setting is the Thinking Summary's default expanded/collapsed state (see "User configuration" below). Whether interim texts get their own visual grouping or are simply ordered among the other segments is a styling choice, not a contract term.

In practice this case is rare in the owner's usage: reasoning-on coding models keep planning in `thinking` blocks and emit a single trailing `text` block (the answer), producing the clean thinking → tool → thinking → tool → answer pattern. Interim text (a `text` block *followed by* a tool call in the same Generation) appears mainly with reasoning turned off, non-reasoning models, or prompts that ask the model to narrate steps. The contract must still handle it correctly, because the current heuristic's dormant path would otherwise misfire if such a model were used.

This has a consequence the earlier draft got wrong: **live classification of a text block is genuinely ambiguous.** When `text_start` arrives, nobody — including Pi — knows yet whether this text is interim commentary or the final answer. That is only decidable retroactively. The resolution is not to pretend the ambiguity away (the earlier "everything is Answer Output forever" rule) and not to solve it with timestamps (the current implementation); it is to accept **exactly one deterministic, structure-triggered reclassification** per text block:

**Classification rule.** A `text` block is **Interim Text** iff, within the same Generation, either:
1. its enclosing Assistant Message ends with `stopReason: "toolUse"`, or
2. a `toolCall` block begins after it (same message or a later message) before settlement.

Everything else — in practice, the Generation's trailing run of text — is Answer Output, and at settlement becomes the Final Answer.

**Streaming behavior.** The trailing text block streams eagerly in the Answer Output position (below the Thinking Summary, full Markdown styling), because delaying text until its classification is known would violate the eager-output requirement. When trigger (1) or (2) fires, that text relocates once into the Thinking Summary at its chronological slot. Notes:

- The relocation trigger is **structural only**: `message_end` with `stopReason: "toolUse"`, or a `toolcall_start`/`tool_execution_start` for a later block. Never timestamps, never "nearest preceding user message", never a settlement-time or reload-time sweep.
- Each text block relocates **at most once** and the move never reverses. Settlement relocates nothing: whatever is in the answer position when the Generation settles simply is the Final Answer.
- Reload and reconnect must reproduce identical classification. This falls out for free: persisted JSONL carries `stopReason` and ordered `content[]`, so the same rule applied to persisted structure yields the same tree. (The current implementation cannot guarantee this, because its live classification uses signals — tool timestamps, frozen stream strings — that persistence does not carry.)
- Thinking blocks do **not** trigger reclassification. If a Generation ends with text followed only by trailing thinking, the text stays Answer Output. Steering that produces a second non-toolUse Assistant Message appends its text to Answer Output in order.
- Implementation should relocate the rendered segment by moving/reparenting its keyed node where feasible, so its content, code-block state, and measured layout survive the move; recreating it inside the trace is acceptable only if visually equivalent.

**Collapsed preview — reproduce `turn-trace.tsx::previewOf` exactly.** The header shows the latest non-empty *text* segment (Thinking Block or Interim Text — never tool names), whitespace-collapsed, clipped to the trailing 120 characters with a leading ellipsis when clipped. Beside it, a tool counter: calls since that latest text, plus the turn total when they differ — `"3 tool calls (5 total)"`, or just `"1 tool call"` when they match. Before any text exists, the neutral label is `"Thinking…"` while active and `"Thinking process"` once idle. This is current behaviour; preserve it verbatim rather than "improving" it.

**User configuration.** The single configurable aspect of the Live Response is whether the Thinking Summary mounts expanded or collapsed by default (default: collapsed, matching today). It is a display-state preference only — it changes neither classification, projection, nor any domain state. Nothing else about interim text, answer placement, or preview content is user-configurable.

Current `main` reaches this UX through `buildTurnRows()`'s `narration` segments (`turn-rows.ts:84-96`) and the `tool_execution_start` freeze in `active-chat.ts:388-418`. The **presentation intent survives** this redesign; the **derivation does not**. Delete the heuristics, keep the outcome.

## Pi's native shapes and the limits of what can be known live

All shapes below were verified against the installed 0.80.6 packages, not upstream `main`:

- `pi-ai` `AssistantMessageEvent` (`dist/types.d.ts`) is a union of `start`, `text_start|text_delta|text_end`, `thinking_start|thinking_delta|thinking_end`, `toolcall_start|toolcall_delta|toolcall_end`, terminal `done` (with full `AssistantMessage` and `stopReason` restricted to `stop|length|toolUse`) and `error` (`aborted|error`). **Every block event carries `contentIndex` and the current `partial: AssistantMessage`.**
- `pi-coding-agent` RPC/extension events (`dist/core/extensions/types.d.ts`): `MessageUpdateEvent` carries the **full** `assistantMessageEvent` (so `contentIndex`, deltas, and `partial` all reach Conduit's stdout reader), and `MessageEndEvent` carries the complete `AgentMessage`. Tool execution has its own `tool_execution_start/update/end` lifecycle keyed by `toolCallId`.
- `AssistantMessage` has **no required stable id** — only an optional provider `responseId`. The server boundary must therefore assign a monotonic assistant-message id at `message_start`, as prescribed below.

These events answer some, but not all, presentation questions:

1. **When has a particular Thinking Block ended?** Definitively at `thinking_end` for that `contentIndex`.
2. **When has a particular Text Block ended?** Definitively at `text_end` for that `contentIndex`.
3. **When has a Tool Call begun or finished being specified?** Definitively at `toolcall_start`/`toolcall_end`. This is distinct from the tool finishing execution.
4. **When has an Assistant Message ended, and why?** Definitively at assistant `message_end`, whose complete message includes ordered `content[]` and `stopReason`.
5. **When has the whole Generation ended?** At the terminal agent lifecycle event, accounting for Pi's retry/settlement behaviour.
6. **When is all thinking for the entire Generation over?** Pi does not provide a single irreversible "reasoning phase ended" event. A later Pi turn may emit more Thinking Blocks after tools.
7. **When a Text Block begins, is it the Answer?** Unknown at `text_start`. It streams provisionally as Answer Output and is reclassified as Interim Text only by the structural triggers in the settled contract. This is the one place the UI performs a (single, deterministic) retroactive move.
8. **Does `text_start` prove that this is the terminal Assistant Message or the last text of the Generation?** No. The Assistant Message may later end with `stopReason: "toolUse"`, tools may execute, and later Pi turns may emit more thinking and text.

The rest of the desired UX:

- The Thinking Summary appears when the Generation begins and is collapsed by default.
- Thinking Blocks stream into its preview and expanded chronology.
- Tool Call Cards appear in their native chronological positions and update in place through execution.
- Interim Text segments sit in their native chronological positions among the Thinking Blocks and Tool Call Cards.
- Later Pi turns may add more Thinking Blocks, Tool Call Cards, and Interim Text to the Thinking Summary. Pi chronology remains intact in domain state and in the trace projection.
- At generation settlement, Answer Output becomes the Final Answer without changing its component identity or presentation.

## Required UX invariants

The restructuring is not permission to redesign the presentation. Preserve these observable behaviours:

- The Thinking Summary is created once per Generation, mounts in the user's configured default state (collapsed unless the user set expanded), and does not repeatedly mount/unmount as event types alternate.
- Its collapsed preview reproduces `previewOf` exactly (latest text segment, 120-char tail, tool counters, neutral fallback). Tool activity updates the adjacent count without replacing the preview with tool names.
- When expanded, Thinking Blocks, Interim Text, and Tool Call Cards are displayed in chronological order. Tool Call Cards are themselves collapsed by default.
- Answer Output streams eagerly through the same Markdown/KaTeX styling used after completion.
- A text block relocates from Answer Output into the Thinking Summary **only** on the structural triggers, at most once, never in reverse, and never at settlement, reconnect, or transcript reconciliation. Classification after reload is identical to classification live.
- Streaming must not produce flashing, vertical oscillation, focus loss, or replacement of the outer response node. The single interim-text relocation is the sole permitted layout movement, and it must move the segment without destroying unrelated DOM identity.
- Completion should look like tokens simply stopped arriving. A final correctness parse may occur internally, but must reconcile into the existing DOM without a visible remount, style transition, height jump, or forced scroll.
- Autoscroll follows only while the user is already near the bottom. User scrolling suspends following. Completion must not create an extra scroll event solely because state was reloaded.
- Reconnecting during generation shows the current live response immediately and then continues with new deltas, without duplicated text, missing tool cards, or a transcript-wide reload.
- Stopping retains the partial output and explicitly marks it stopped. A late event belonging to the closed Generation must not reopen or mutate it.

## Target domain and transport architecture

### 1. Preserve, normalize, and reduce—do not flatten

`PiManager.handleStdout()` should normalize Pi events into a small Conduit transport schema without discarding native relationships. The normalizer may reduce provider-specific metadata that Conduit does not use (including the potentially large `partial` message on every delta — the reducer maintains that state itself), but must preserve:

- Conduit `generationId`
- assistant-message identity — a stable Conduit identity assigned at `message_start`, since Pi 0.80.6 exposes none (verified: `AssistantMessage` has only optional `responseId`)
- assistant role and message lifecycle
- `contentIndex`
- content-block type and ordered position
- thinking/text deltas and completed content
- complete `message_end` content and `stopReason`
- tool-call ID, name, arguments and block position
- tool execution lifecycle joined by `toolCallId`
- usage/error/abort information required for completion and diagnostics

Do not continue emitting `assistant_stream_delta` and `assistant_stream_final`. Those messages are a second, lossy protocol created only for flattened answer text. Forward normalized `message_update` events for all block types and a full normalized `message_end`.

The current `live-events.ts` explicitly strips `contentIndex`, removes text delta content from ordinary `message_update` (`text_delta` normalizes to an empty marker, `live-events.ts:153`), and ignores all `toolcall_*` block events (no cases exist; they fall to `unknown`). The server side never forwards native text deltas at all while a stream is open (`pi-manager.js:404` intercepts them into `handleTextDelta`) and converts assistant `message_end` into `assistant_stream_final` (`pi-manager.js:541-559`) whose client normalization keeps only the flattened `content` string. Reverse all of those choices.

### 2. One Active Generation representation

Use one reducer model for the current Generation. A representative shape is:

```ts
interface ActiveGeneration {
  id: string;
  status: "submitting" | "running" | "stopping" | "stopped" | "complete" | "failed";
  assistantMessages: LiveAssistantMessage[];
  toolExecutions: Map<string, LiveToolExecution>;
  startedAt?: string;
  settledAt?: string;
}

interface LiveAssistantMessage {
  id: string;                 // assigned by Conduit at message_start
  status: "streaming" | "complete" | "error";
  stopReason?: PiStopReason;
  blocks: LiveContentBlock[];
}

type LiveContentBlock =
  | { type: "thinking"; contentIndex: number; text: string; status: BlockStatus }
  | { type: "text"; contentIndex: number; text: string; status: BlockStatus }
  | { type: "toolCall"; contentIndex: number; toolCallId: string; name: string; arguments: unknown; status: BlockStatus };
```

Identity is `(generationId, assistantMessageId, contentIndex)` for content blocks and `toolCallId` for joining execution state. Do not use timestamps or "nearest preceding user message" as identity.

Interim-vs-answer classification is **not** stored on the block — it is a pure function of this tree (the classification rule reads `stopReason` and the positions of `toolCall` blocks), so live state, resume state, and persisted state can never disagree about it.

The client reducer and server resume-state reducer may share pure reducer logic or fixtures, but they have different responsibilities:

- The server holds enough reduced state to let any browser attach mid-generation and to recover a slow socket.
- The client holds reactive presentation state and updates only the affected block signal/store path.
- Durable JSONL remains the source of truth for completed conversation history.

Do not retain five competing live representations (`messages`, `tools`, `reasoning`, `liveStream`, later checkpoint reload — all five verified present in `active-chat.ts`). During generation, the Active Generation is authoritative for the Live Response. On completion, commit its normalized final messages into the Transcript in place; let durable persistence confirm rather than visually reconstruct the result.

### 3. Reconnect is just WebSocket reconnect plus Resume State

The user-facing and client-facing contract should remain simple:

1. The browser opens or reopens `/v0/live-sessions/:id/stream`.
2. `PiManager.attach()` registers the socket.
3. Before ordinary live events, the server sends one `generation_resume` payload containing the current process/generation state.
4. The browser idempotently replaces or reconciles its Active Generation with that payload.
5. Subsequent events continue from the same reducer.

The name `generation_resume` is recommended over `runtime_snapshot` for the response-specific portion, though general process state may remain in `runtime_snapshot`. It is an in-memory current-state view, not a persisted snapshot and not an event log.

Current `main` already approximates this: the upgrade handler (`server.js:1417-1441`) sends `runtime_snapshot` with `record.events` since the last `agent_start` plus `record.stream.chunks.join("")`. However:

- `record.events` is capped at 500 (`pi-manager.js:762`), so a long thinking/tool sequence can be truncated.
- answer deltas are deliberately removed and replaced with one flattened string.
- thinking and tool state are reconstructed by replaying whatever events survived, not represented as current block state.
- content identities and complete assistant boundaries were already discarded.
- the event replay grows with token/event count and is not an efficient current-state representation.

Replace this with the reduced Active Generation. There is no need to persist it separately while the Pi process is alive. If the Conduit server itself restarts, recover completed material from Pi's session JSONL. Recovery of an unpersisted in-flight token after a server crash is a separate durability feature and is not required for ordinary browser reconnect.

Pi RPC also exposes session state and messages, and these may be useful as a recovery check. They do not remove the need for Conduit's attach-time state transfer: the Conduit server is already the sole long-lived reader of the Pi child process's JSONL event stream, while browser sockets can come and go. Prefer the reducer Conduit is already maintaining over issuing a full `get_messages` request for every browser reconnect.

### 4. UI projection rules

Project the Active Generation without losing its original sequence:

- Every `thinking` block projects to a Thinking Block in the Thinking Summary.
- Every `toolCall` block projects to a Tool Call Card in the Thinking Summary and reads execution status by `toolCallId`.
- Every `text` block classified interim projects to an Interim Text segment at its chronological position in the Thinking Summary.
- The trailing unclassified `text` run projects to Answer Output and streams there; the classification rule (not the projection layer) decides when a block leaves that run.
- At Generation settlement the existing Answer Output is called the Final Answer; nothing relocates at settlement.
- The Thinking Summary may group several Pi turns into one Generation-level disclosure, but must preserve the chronological ordering of its child segments.
- Concatenation of adjacent answer text blocks is a projection concern; preserve their separate native identities in state.

`buildTurnRows()` should no longer reverse-engineer live structure from flat persisted messages, global tools, a global reasoning string, timestamps, and "last non-toolUse assistant." Retain a separate, bounded projection for already-persisted history if needed — persisted history uses the *same* classification rule over persisted `stopReason`/blocks, which is why live and reloaded transcripts cannot diverge — but the live path is a direct projection from Active Generation.

### 5. Delta batching and fine-grained reactivity

Use one batching mechanism for thinking and text:

- Buffer deltas per block identity.
- Flush at most once per animation frame on the client.
- Coalesce adjacent deltas for the same block on the server over a very small time window or output-size threshold.
- Flush immediately before structural boundaries (`*_end`, new block, tool execution transition, message end, stop/error).
- Updating one block's text must not rerun the full Transcript or rebuild all timeline rows.

In Solid, structure should be reactive at the message/block collection level, while each mutable text block has its own accessor/store path. `ThinkingSummary` preview subscribes only to its anchor segment and tool count. Expanded segment renderers subscribe only to their own content. Answer Output subscribes to its ordered text blocks. Transcript structure changes when messages or blocks are inserted, finalized, or reclassified — not on each token delta.

(For scale of the current problem: `thinking_delta` appends synchronously to one global `reasoning` signal with no frame batching (`active-chat.ts:342`), `createTimelineStore` rebuilds `buildTurnRows()` over all messages and tools on every such update (`timeline-store.ts:17-23`), and the Transcript's autoscroll effect *also* subscribes to `reasoning().content` (`transcript.tsx:38`), so every thinking token additionally schedules scroll work.)

### 6. Incremental Markdown without visible completion churn

The current reconciler is valuable: it preserves DOM identity when reparsing canonical Markdown. Keep that property. The problem is that every frame still runs Marked, KaTeX and DOMPurify over the entire accumulated document and constructs a complete temporary DOM fragment (`markdown.tsx:102-109` — the effect re-parses the full source whenever it changes).

Implement a renderer-recognized stable prefix plus mutable tail:

- Completed top-level Markdown blocks become immutable sanitized DOM regions.
- Only a bounded unfinished tail is reparsed while streaming.
- The tail boundary must be chosen by the Markdown parser/tokenizer, not by a handwritten delimiter splitter that guesses fenced-code, list, table, math, or reference-definition state.
- The outer `ChatMarkdown` node and stable completed children retain identity.
- At block/message completion, run one canonical whole-source parse for correctness and reconcile it into the same DOM.

Markdown can contain constructs that retroactively affect earlier content, especially reference definitions. The final whole-source pass is therefore allowed and sometimes required. The invariant is **no user-visible final rerender**, not "the parser may never run at completion."

If a safe parser-derived stable prefix cannot be implemented without effectively maintaining a Markdown parser, choose a simpler bounded cadence: render a growing source less frequently as it lengthens, while displaying a plain/safely escaped short tail between canonical parses, then reconcile canonically at boundaries. Do not reintroduce a bespoke Markdown syntax splitter merely to claim strict incrementality.

## Prioritized findings

All file/line anchors verified at `c8257ad`.

### [P1] 1. The live-response bridge discards Pi's canonical structure

`pi-manager.js` intercepts assistant text deltas into `assistant_stream_delta` (`handleTextDelta`, `pi-manager.js:534`), intercepts assistant `message_end` into `assistant_stream_final` (`finishAssistantMessage`, `pi-manager.js:541` — text blocks joined with `\n`), and does not publish the original full assistant boundary. `live-events.ts` strips `contentIndex`, discards text delta content in native updates, and ignores `toolcall_*` updates. The client later synthesizes structure from tool starts, separate reasoning state, timestamps, and transcript checkpoints — notably `tool_execution_start` freezing the streamed strings into the last assistant message and stamping a synthesized `stopReason: "toolUse"` (`active-chat.ts:388-418`).

**Required direction:** implement the target domain/transport architecture above. This is the root fix for the streaming system; do not independently patch the existing `reasoning`, `liveStream`, `tools`, `messages`, and checkpoint heuristics.

**Acceptance:** recorded Pi event fixtures can be reduced deterministically into the same ordered block tree live, after reconnect, and after persistence reload.

### [P1] 2. Streaming Markdown work is unbounded and approximately quadratic

Answer text is frame-batched, but every frame sends the complete accumulated source through Marked, KaTeX, DOMPurify and whole-tree reconciliation. Reasoning text is even hotter because it is not frame-batched at all and also drives timeline projection and scroll scheduling. Preserving node identity prevents visual flashing but does not bound parse/sanitize work.

**Required direction:** unify block-level batching and implement the incremental/cadenced Markdown strategy above. Apply the same renderer contract to Thinking Blocks, Interim Text, and Answer Output.

**Acceptance:** doubling a long generated response should not produce approximately four times the aggregate parse/sanitize work. Track parsed characters or renderer work units in tests. Preserve existing DOM-node identity and height-stability browser assertions.

### [P1] 3. WebSocket delivery has no backpressure boundary

`PiManager.publish()` (`pi-manager.js:759`) sends every event to every socket without checking `bufferedAmount`. Browser frame batching does nothing to reduce server serialization, send calls, or native socket buffering. Slow mobile/tunnel connections or multiple tabs can accumulate unbounded queued bytes.

(Severity note: for a single-user self-hosted deployment this is robustness rather than an immediate hazard; it stays P1 because its safe recovery mechanism *is* the Resume State — implementing backpressure against the flattened stream would create a third temporary protocol, so it must land inside this redesign.)

**Required direction:**

- Coalesce adjacent deltas by block identity server-side.
- Preserve strict ordering around structural and tool events.
- Set a per-client high-water mark using `bufferedAmount`.
- Once a client exceeds it, stop enqueueing superseded deltas for that client. When writable again, send the current `generation_resume` state and continue with new events.
- Never drop message boundaries, tool completion, stop/error, or generation-settlement state.
- Keep per-client delivery state outside the canonical Active Generation.

**Acceptance:** a deliberately stalled WebSocket client has bounded buffered bytes and, after recovery, converges to the same live tree as an uninterrupted client.

### [P2] 4. Reasoning deltas bypass the batched, fine-grained path

Every `thinking_delta` appends to a global reasoning signal (`active-chat.ts:342`, synchronous, unbatched — unlike `liveStream`, which has rAF batching). `createTimelineStore()` subscribes to that signal and rebuilds `buildTurnRows()` across all visible messages/tools for every reasoning update; the Transcript's scroll effect additionally subscribes to `reasoning().content` (`transcript.tsx:38`) and schedules a rAF scroll per token.

**Required direction:** remove global reasoning text. Buffer/update the relevant Thinking Block by message/block identity. Only its Markdown view and the Thinking Summary preview should react. Structural timeline projection must not depend on block text content, and scroll scheduling must key off content-height changes, not raw signal writes.

### [P2] 5. Completion is reconstructed through multiple competing commits

The current path combines `assistant_stream_final`, `agent_end`, the `tool_execution_start` freeze, and a later `session_checkpoint` fetch/reconciliation (`active-chat.ts:328-330` triggers a full `loadDetail` reload). This can produce races and unnecessary complete-transcript work even when node-preservation tests hide visible churn.

**Required direction:** full assistant `message_end` finalizes that live message in place; terminal agent settlement finalizes the Generation; persistence/checkpoint updates registry metadata and confirms durable identity. Fetch transcript content only for reconnect after the server lost live state or when a detected mismatch requires reconciliation.

### [P2] 6. Current reconnect replay is capped and lossy

The existing `runtime_snapshot` proves that browser WebSocket reconnect is the correct UX. Its implementation replays at most 500 retained events since the most recent `agent_start` and separately supplies one flattened current text stream. Long generations can exceed the cap, thinking/tool state may be incomplete, and block identity cannot be recovered.

**Required direction:** replace event-history replay with the structured Resume State described above. Keep only a small diagnostic ring buffer if useful; do not use it as application state.

## Implementation sequence

This ordering minimizes the period in which both old and new heuristics coexist:

1. **Capture fixtures first.** Record representative raw Pi 0.80.6 RPC sequences from Conduit: no-thinking answer; thinking then answer; multiple tool turns; parallel tools; text before tool use; multiple text/thinking blocks; retry; stop; provider error; reconnect during thinking; reconnect during answer. Redact content as necessary but preserve exact event shapes.
2. **Define the normalized protocol and pure reducer.** Preserve `contentIndex`, complete message boundaries, stop reasons, and tool-call identity. Include the interim-text classification function and test it against fixtures before touching presentation.
3. **Build the server Active Generation/Resume State.** Feed the same normalized events through it. Continue emitting the old events temporarily only behind an adapter if required for migration.
4. **Make reconnect consume structured Resume State.** Prove attach/re-attach convergence and generation-ID idempotence before removing the event replay.
5. **Replace client live state with one Active Generation reducer.** Remove global `reasoning`, `liveStream`, live tool synthesis, and checkpoint-driven completion reconstruction.
6. **Project `ThinkingSummary` and `AnswerOutput`.** Preserve the current styling/interaction; replace the heuristic `narration` derivation with structure-derived Interim Text under the settled contract.
7. **Unify client and server delta batching; add socket backpressure.** Structural correctness must exist before coalescing is introduced.
8. **Bound Markdown work.** Retain DOM reconciliation and verify presentation parity.
9. **Remove compatibility paths and rename canonical components/types.** Do not leave two live-response protocols indefinitely.

Coordinate this sequence with the companion review, but do not couple the independent transcript-access, startup, or Host-Pi preflight fixes to the rendering migration.

## Test matrix and acceptance criteria

### Protocol/reducer tests

For each raw fixture, assert:

- stable assistant-message and content-block identity
- exact ordered blocks after every structural event
- idempotent application of Resume State followed by later events
- no duplicate delta when reconnect occurs between server flushes
- correct `toolCallId` join for sequential and parallel tools
- interim-text classification is identical when computed live event-by-event, from Resume State, and from persisted JSONL structure
- classification changes exactly once per interim block, at the correct structural trigger, and never at settlement
- `stopReason` drives both agent lifecycle and interim classification, and nothing else
- late events for closed/stopped generation ignored
- retry gaps do not incorrectly settle or erase the active generation

### Browser presentation tests

Assert:

- Thinking Summary appears once and begins in the configured default state (collapsed unless the user set expanded)
- preview text/counter behaviour matches `previewOf` verbatim (latest text segment, 120-char tail, `"N tool calls (M total)"` counters, neutral fallback)
- expanded chronology matches raw Pi block/tool order, including Interim Text positions
- Tool Call Cards retain DOM identity as execution state changes
- Answer Output root and stable Markdown nodes retain identity through streaming and completion
- text emitted before a later tool call relocates into the trace exactly once, retains its content, and produces no duplicate rendering in either surface
- later Thinking Blocks, Interim Text, and Tool Call Cards update the collapsed Thinking Summary without disturbing Answer Output's DOM identity
- no completion-only height jump or scroll jump
- user scrolling disables follow mode; reconnect does not force follow mode back on
- reconnect during each streaming phase (thinking, interim text, answer, tool execution) immediately restores current content with correct classification and continues

### Performance tests

Measure work, not only elapsed time:

- Markdown characters/tokens parsed and sanitized per generated response
- number of Transcript structural projections per N deltas
- WebSocket sends and peak `bufferedAmount` per client
- resume payload size relative to current active content, independent of raw delta count

Expected qualitative bounds:

- structural projections scale with messages/blocks/tool transitions, not token count
- Markdown streaming work is materially sub-quadratic
- resume payload scales with current reduced Generation state, not retained event history
- socket memory remains bounded for stalled clients

## Explicit non-goals and guardrails

- Do not change the visible layout. The Thinking Summary defaults to collapsed; its default expanded/collapsed state is the *only* configurable aspect of the Live Response, and even that changes no domain state. Do not add any other interim-text or answer-placement setting.
- Do not collapse Pi's multiple assistant messages into one destructive text concatenation in domain state, even if the UI presents one Generation-level disclosure.
- Do not expose raw provider reasoning terminology in product copy where "Thinking" is already the settled UX language.
- Do not treat `thinking_end` as proof that no later thinking will occur in the Generation.
- Do not delay text display until its interim/answer classification is known; the trailing text streams provisionally as Answer Output.
- Do not derive interim classification from anything but Pi structure (`stopReason`, block order). No timestamps, no "nearest preceding user message", no frozen stream strings.
- Do not reclassify at settlement, reconnect, or reload; the structural triggers are the only reclassification points, once per block, irreversible.
- Do not make the browser read Pi JSONL or connect directly to Pi. Conduit remains the transport and lifecycle owner.
- Do not add a database or durable event-sourcing subsystem for ordinary WebSocket reconnect.
- Do not use the 500-event diagnostic ring as authoritative live state.
- Do not implement an ad hoc Markdown delimiter splitter that can make final Markdown incorrect.
- Do not broaden this document into general application/server cleanup. The companion review owns those findings and the overall bundle/test assessment.

## Verification appendix (2026-07-23)

Every mechanical claim in this document was checked against the `c8257ad` checkout and the installed 0.80.6 Pi packages:

- **Pi event contract**: `contentIndex` on all block events, distinct `thinking_*`/`text_*`/`toolcall_*` types, `partial` message on updates, full message + `stopReason` at `done`/`message_end` — all present in the installed `.d.ts` files. `AssistantMessage` carries no required id (optional `responseId` only), confirming the need for a server-assigned message identity.
- **Bridge flattening**: confirmed at `pi-manager.js:404`, `:534`, `:541`; client stripping at `live-events.ts:146-157` (empty `text_delta` marker, no `toolcall_*` cases).
- **Snapshot replay**: confirmed at `server.js:1417-1441` (slice since last `agent_start`, deltas filtered, flattened `stream.chunks.join("")`), ring cap at `pi-manager.js:762`.
- **Five live representations and the completion race**: confirmed in `active-chat.ts` (`messages`, `tools`, `reasoning`, `liveStream`, `session_checkpoint` reload).
- **Unbatched reasoning + scroll coupling**: confirmed at `active-chat.ts:342`, `timeline-store.ts:17`, `transcript.tsx:38`.
- **Whole-document Markdown per frame**: confirmed at `markdown.tsx:102-109`.
- **Current narration heuristics** (timestamp tool attachment, last-non-toolUse bubble, `tool_execution_start` freeze): confirmed at `turn-rows.ts:59-96` and `active-chat.ts:388-418`. Code comments show the interim-text-in-trace UX is deliberate; this spec keeps that UX and replaces its derivation.

## Source notes

- Structured protocol foundation: `conduit-web/src/pi-event-normalizer.js`,
  `conduit-web/src/active-generation.js`, and
  `conduit-web/test/fixtures/pi-rpc-generations.js`
- Conduit integration target: `conduit-web/src/pi-manager.js`, `server.js`, `client/api/live-events.ts`, `client/state/active-chat.ts`, `client/state/live-stream.ts`, `client/state/timeline-store.ts`, `client/turn-rows.ts`, `client/chat/transcript.tsx`, `client/chat/turn-trace.tsx`, `client/chat/markdown.tsx`
- Pi upstream: <https://github.com/earendil-works/pi> (repository renamed from `badlogic/pi-mono`; use the new name for research)
- Pi streaming content-block contract: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md>
- Installed types (authoritative over upstream `main` and generated docs): `node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
