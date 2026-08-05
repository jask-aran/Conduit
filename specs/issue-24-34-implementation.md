# Issues #24 and #34 implementation

Status: Slice 1 complete at `024ce4c`. Slice 2 committed at `6a713f2`.
Slice 3 committed at `288db80`. Slice 4 committed at `296d822`. Slice 5
Marked baseline is recorded below. Slice 6 committed at `0e4d366`. #24 path:
renderer A/B (6a) → incomplete-construct streaming (6b) → decision (7) →
optional adoption (8). **Slice 9** (desktop panel motion under heavy KaTeX) is
queued as a separate shell-layout track; it does not block the #24 gate.
Issue #24 remains open.

Issues:

- [#24 — Evaluate Incremark for incremental Markdown streaming](https://github.com/jask-aran/Conduit/issues/24)
- [#34 — Make live transcript updates block-granular](https://github.com/jask-aran/Conduit/issues/34)

Base: `main` at `0be7f12` (`Fix browser canary follow-ups`).

This is the implementation record and remaining execution plan. Keep durable
architecture and testing contracts in `README.md`, `conduit-web/README.md`,
and `docs/operations/testing.md`. Record slice decisions, measurements, and
verification here. Temporary command output may use `/tmp`, but it is not the
progress record. Remove this file after both issues close; Git retains its
history.

## Slice 3 handoff

Slice 3 keeps the existing event protocol, active-generation reducer,
Markdown renderer, DOM contracts, and scroll behavior. `active-chat.ts` now
publishes the changed block or tool identity. `timeline-store.ts` caches the
live projection index and patches one answer row, trace segment, or tool
segment for ordinary deltas. Structural boundaries still use the full
projection path. `turn-rows.test.js` covers the block-to-row index and
`timeline-projection.test.js` benchmarks persisted rows and active dimensions.

The rich-Markdown browser harness measured 38 timeline projection passes: 7
full projections and 31 narrow patches. The prior baseline performed 38 full
projections, so Slice 3 avoided 31 of 38 full rebuilds (81.6%). Markdown work
remains separate and unchanged in scope. The final rich run delivered 31 of
31 deltas, matched the structural fingerprint, ended at zero scroll distance,
recorded 43 DOM mutations, recorded zero Long Tasks, and reported no errors.
The 210-delta scroll run used 7 full projections and 210 narrow patches,
retained zero distance from the bottom, and reported no errors.

The `slice3-timeline-projection-benchmark` covered persisted row counts
`[1, 8, 32]`, active message counts `[1, 4, 16]`, active block counts
`[1, 4, 16]`, and active tool counts `[0, 8, 32]`. Every one of the 12 cases
changed one narrow row. Full projection row count grew from 5 to 67 when
persisted rows grew from 1 to 32. This benchmark measures projection scaling;
it is not a claim of end-to-end latency improvement. Slice 6 now records the
Incremark parser, compatibility, and bundle measurements below.

Verification after the final fix: `npm run typecheck`, `npm test` (266 passed),
`npm run build`, the rich, scroll, reconnect, code-copy, and
external-confirmation browser harness fixtures, the 12-case
`slice3-timeline-projection-benchmark`, and six focused Playwright
trace/reconnect tests passed. The managed server was rebuilt and restarted
with `bash .devcontainer/start-conduit.sh restart`; health returned ready and
the listener was `0.0.0.0:4310`. Authenticated agent-browser smoke testing
loaded the managed route and completed one live prompt without a visible
error. Slice 3 is committed at `288db80`; Slice 6 is next for owner review.

## Revised execution order after Slice 3

Slice 6 now moves ahead of the remaining renderer and boundary work. It has two
bounded parts: an isolated Incremark compatibility spike and an opt-in local
renderer switch on the managed `4310` server. The spike uses a temporary
fixture, the same deterministic Markdown inputs, and the current renderer as
its comparison. The local switch uses the pinned `@incremark/core` parser in a
lazy Solid adapter. Marked remains the default. `@incremark/solid` remains
temporary-only because its published wrapper fails in this repository's Solid
runtime.

Slices 4, 5, and 6 are recorded. **Next is the renderer A/B benchmark**, then
Slice 6b (shared streaming incomplete-construct presentation on Marked and the
Incremark adapter). Slice 6b is not adoption; it closes a measured streaming
presentation gap both paths share and that the Slice 6 adapter left
unhandled. Do not treat the local switch or Slice 6b as adoption evidence.
Slice 8 remains blocked on explicit owner approval after Slice 7.

**Slice 9** (desktop panel motion under heavy KaTeX / long transcripts) is a
shell-layout investigation. It may run after Slice 6b measurements land, or in
parallel with Slice 7 docs work, but must not change renderer semantics or
steal the #24 decision. Implement a panel-motion fix only after Slice 9 picks
a candidate with frame-time evidence.

The slice headings below define scope and acceptance criteria. This section
defines the execution order.

## Manual validation checklist — Slice 3

Run the managed server with `bash .devcontainer/start-conduit.sh restart` and
open `http://127.0.0.1:4310` from Windows. Use an existing authenticated chat
or create a disposable chat. Record each item as pass or fail.

- Stream a response with thinking, at least one tool call, and a final answer.
  The answer must grow without missing or duplicated text. The trace header,
  thinking text, tool card, tool status, and final answer must remain visible.
- Expand the trace while the response is complete. Segment order must remain
  thinking, narration or interim text, tool, then answer as supplied by the
  response. Tool completion must not replace the trace row or move the answer.
- During a long Markdown response, check headings, lists, tables, fenced code,
  links, and incomplete syntax. The live answer must not remain stuck on
  `Thinking…` after text arrives.
- Scroll away from the bottom during streaming. New tokens must not force the
  viewport to the bottom. Return to the latest position and confirm follow
  mode resumes.
- Refresh or reconnect during thinking, a tool call, and the answer. Confirm
  there is one final response with no duplicate or missing text.
- Use code-copy and an external link. Code copy must succeed; the external
  link must show the existing confirmation control. Check the browser console
  for errors and confirm the normal build does not expose
  `window.__conduitHarness`.

Expected result: no protocol or visible behavior change, no stuck trace
header, no row or content duplication, preserved scroll-away behavior, and
the existing security and interaction controls.

## Decision boundary

Treat the issues as two measured layers in one stream:

```text
Pi/provider events
  → Conduit normalization and WebSocket delivery
  → client live-generation state
  → timeline and block projection
  → Markdown parsing and sanitisation
  → DOM reconciliation
  → scrolling and animation frames
```

Issue #34 covers client state, projection, reconciliation triggers, and
scroll scheduling for ordinary deltas. Issue #24 covers Markdown parsing,
sanitisation, DOM stability, compatibility, and bundle cost. Evidence for
one issue cannot close the other.

Do not replace the current renderer without a focused compatibility spike,
measured evidence, and owner approval. The local switch is an investigation
surface only. The exact `@incremark/core` dependency and lockfile entries are
permitted for that surface; the high-level `@incremark/solid` package stays out
of the production dependency graph.

## Worker execution contract

Run one slice at a time. Give one bounded implementation worker only the
approved slice, its starting commit, the expected dirty files, the required
reads, and the acceptance checks below. The worker must not start the next
slice or fix adjacent defects.

Before edits, the worker must:

1. confirm `git status --short` matches the recorded slice state;
2. propose the exact file list if the slice needs more than three files, then
   wait for owner approval;
3. read the relevant sections of `README.md`, `conduit-web/README.md`,
   `docs/operations/testing.md`, and `docs/references/distillations.md`;
4. state any assumption that changes ownership, protocol, security, or visible
   behavior.

Each worker returns one reviewable handoff:

- behavior changed and behavior held constant;
- files changed;
- exact commands run, exit status, and redacted report paths;
- failures copied verbatim;
- acceptance criteria met or not met;
- remaining risks and the cheapest next diagnostic.

Stop after the handoff. The owner and coordinating agent review the evidence,
perform the required manual checks together, and approve, revise, or reject the
slice before its commit and before the next worker starts. After two failed
attempts at the same error, stop and report ranked hypotheses instead of
patching again.

## Current architecture and causal path

### Server and provider boundary

`conduit-web/src/pi-event-normalizer.js` converts Pi JSON-RPC events into
structured Conduit events. The events carry a generation ID, sequence number,
assistant-message ID, content index, block type, and delta. The server assigns
stable identities before delivery.

`conduit-web/src/active-generation.js` reduces those events into the live
generation. An ordinary text delta currently clones the generation, the
assistant-message array, the matching message, and its block array before it
appends text. Classification also walks active assistant blocks to separate
thinking or narration from the answer.

`conduit-web/src/pi-manager.js` coalesces same-block deltas for each socket,
flushes before structural boundaries, and sends resume state after reconnect
or slow-reader recovery. This limits server delivery pressure, but it does not
limit the client work after each delivered event. Pi JSONL remains the durable
transcript authority. `conduit-web/src/server.js` publishes the terminal
checkpoint; the client then reconciles persisted transcript content in
`active-chat.ts`.

### Client state and projection

`conduit-web/src/client/api/live-events.ts` normalises wire events into the
client event union. `conduit-web/src/client/state/active-chat.ts` applies each
structured event by calling `reduceActiveGeneration`, then derives blocks,
thinking/responding state, active tool state, retry state, and generation
state.

`conduit-web/src/client/state/timeline-store.ts` reacts to `messages()`,
`tools()`, and `activeGeneration()`. Each change runs `buildTurnRows` and
reconciles the full row list by key.

`conduit-web/src/client/turn-rows.ts` walks historical messages, tool
executions, and the active generation. It rebuilds live trace segments,
answer rows, owner mappings, and classification on each projection call. The
live row key is stable, but the projection input is replaced wholesale.

`conduit-web/src/client/chat/transcript.tsx` reacts to live-generation changes,
renders the timeline, and schedules follow-scroll work with
`requestAnimationFrame`. `TurnTrace` and assistant rows lazy-load
`conduit-web/src/client/chat/markdown.tsx`.

### Markdown, DOM, and browser work

`conduit-web/src/client/chat/markdown.tsx` parses assistant Markdown with
Marked, the KaTeX extension, and GFM rules. It sanitises the result with
DOMPurify, removes images and unsafe URLs, turns external links into the
existing confirmation control, and preserves Conduit artifact controls.
`ChatMarkdown` reparses and sanitises the current accumulated source when its
source or version changes. `reconcileChildren` reuses compatible DOM nodes,
but it does not remove parser, sanitizer, or tree-comparison cost.

The browser then performs DOM mutations, layout and scroll work, and paints
animation frames. The investigation must measure these stages separately.

## Work on every delta versus structural boundaries

| Stage | Ordinary text delta | Structural boundary, resume, or checkpoint |
| --- | --- | --- |
| Pi normalisation | Creates one structured delta | Creates start/end, tool, retry, stop, or error event |
| Server delivery | May coalesce same-block deltas, then flush | Flushes pending deltas before the boundary; may send resume state |
| Active generation | Clones broad generation state and appends text | Adds/removes messages or blocks, changes status, or replaces from resume |
| Client derived state | Recomputes block list, thinking/responding, and tool lookup | Recomputes the same plus structural state changes |
| Timeline projection | Rebuilds all turn rows and classifications | Must rebuild affected structure and boundary classification |
| Markdown | Parses and sanitises accumulated live source | Parses final or newly structural content; checkpoint may reconcile |
| DOM | Reconciles the live Markdown tree | Adds/removes rows, controls, tools, or final content |
| Scroll | Current follow mode schedules a frame after live changes | Must preserve anchor and settle after layout or navigation |

The target for #34 is to make the ordinary-delta path address one mutable
block and its dependent live row. Structural boundaries may perform broader
work. The target for #24 is to reduce or bound Markdown work without changing
security or visible output contracts.

## Baseline commands and evidence

Run from `conduit-web`:

```bash
npm run typecheck
npm test
npm run build
npm run test:harness -- --help
npm run test:harness:browser -- --help
```

Transport scenarios use `npm run test:harness` with named fixture IDs and
profiles `steady`, `burst`, `stall`, `high-tps`, and `jitter`. Browser scenarios
use `npm run test:harness:browser` with `stream` or `reconnect` flows. The
exact command line and JSON output belong in each report. Use the managed
server path from `docs/operations/testing.md`; do not launch Node directly.

The baseline already recorded at this base includes:

- typecheck passed;
- 259 unit and server tests passed;
- production build passed;
- initial JavaScript: 124,366 bytes gzip;
- Markdown lazy chunk: 103,580 bytes gzip;
- plain browser stream passed;
- long high-throughput browser stream passed with 163 WebSocket deltas and
  165 DOM mutations;
- reconnect passed with two sockets, one resume, zero duplicate characters,
  and final-content recovery;
- transport final-delta parity passed;
- the rich-Markdown browser scenario did not complete because the harness
  compared rendered `textContent` with raw Markdown. This is a harness
  contract defect, not renderer evidence. Fix the comparator before using that
  scenario for renderer decisions.

Each report must include fixture ID, commit, source character count, source
delta count, delivery profile, browser/runtime, command, and redacted JSON
measurements. Do not retain prompts, credentials, cookies, or transcript
bodies.

### Authenticated agent-browser workflow

Use the deterministic browser harness for performance measurements.
Agent-browser supplies one authenticated regression check at a slice boundary;
it is not the performance runner. Do not repeat broad UI exploration after the
required controls pass.

Start the managed application with the standard WSL-accessible bind from the
repository root:

```bash
bash .devcontainer/start-conduit.sh restart
curl -fsS http://127.0.0.1:4310/healthz
```

The launcher intentionally keeps `CONDUIT_HOST=0.0.0.0` by default. Windows
must reach the server through WSL, so this verification must use the same bind
surface as normal local use. `127.0.0.1:4310` is only the client and health-check
URL from the WSL side; it is not a request to bind the server to loopback.

Load the installed browser instructions, derive the worktree session, and open
the managed application:

```bash
agent-browser skills get core
SESSION="$(agent-browser session id --scope worktree --prefix conduit-qa)"
agent-browser --session "$SESSION" --restore open http://127.0.0.1:4310
agent-browser --session "$SESSION" snapshot -i -c
```

If Conduit shows the sign-in page, enter the local password through hidden
interactive input or the agent-browser authentication vault. Never place a
password in a command, log, report, screenshot, or this file. After sign-in,
take a new snapshot because prior element references are stale.

Use existing chats unless a live provider run has separate approval. Check
only the affected contracts:

- the authenticated chat route loads without page or console errors;
- the normal build does not expose `window.__conduitHarness`;
- an existing long Markdown transcript retains headings and semantic content;
- scroll-away leaves a positive distance from the bottom and return-to-latest
  restores zero distance;
- fenced-code copy accepts the action;
- an external link opens the `Open external link?` confirmation dialog.

Close the session after the checks:

```bash
agent-browser --session "$SESSION" close
```

Record the observed results in this file. Do not treat screenshots, daemon
state, or `/tmp` output as the durable result.

Instrumentation must be opt-in before it calls timers, constructs metric
objects, or appends samples. Use a separate instrumented build or an equivalent
early gate. For one representative scenario, compare instrumented and
uninstrumented runs so the report states the observer effect. Use the
uninstrumented production build for bundle baselines.

### Required measurements

Keep these series separate:

1. Source and WebSocket cadence: source count, delivered count, inter-event
   gaps, coalescing, stalls, reconnect and resume timing.
2. Client state and projection: reducer count, changed generation/block IDs,
   clone counts or allocation proxy, projection count, projection duration,
   row count, and changed row keys.
3. DOM: mutation count by type and target, outer live-response identity,
   semantic node identities for heading/list/table/code/math/link, and row-key
   churn.
4. Markdown: parse, KaTeX, sanitisation, and reconciliation duration,
   cumulative source length, and work per delta.
5. Browser scheduling: frame timestamps, gaps over 32/50/100 ms, Long Tasks,
   scroll operations, and distance from the bottom.
6. User-visible result: first visible text, visible-text increments and gaps,
   final semantic content, persistence after checkpoint, and reconnect
   reconciliation.

The semantic result is not normalized `textContent`. Define a small structural
fingerprint containing element type, hierarchy, text, and the attributes that
carry Conduit behavior. Add explicit assertions for unsafe-element absence,
URL handling, external-link confirmation, KaTeX, fenced-code copy controls,
and artifacts. Keep normalized text as a separate cadence measurement.

Do not use subjective smoothness as the only result. Use agent-browser for
manual interaction quality and the deterministic browser harness for repeatable
measurements. Promote only release canaries to Playwright.

## Deterministic fixture matrix

Use the same source text and delta sequence for the current path and every
candidate. Give each fixture a stable ID.

| Group | Fixtures |
| --- | --- |
| Cadence | `plain-short-steady`, `plain-long-steady`, `plain-long-high-tps`, `plain-long-burst`, `plain-jitter`, `plain-stall`, `plain-slow-reader` |
| Markdown completion | `incomplete-heading`, `incomplete-emphasis`, `incomplete-link`, `incomplete-list`, `incomplete-table`, `incomplete-fence`, `incomplete-reference`, `incomplete-math-block`, `incomplete-math-inline` |
| Markdown features | `gfm-heading-list-emphasis`, `gfm-table`, `fenced-code-artifact`, `katex-inline-block`, `internal-link`, `external-link-confirmation`, `unsafe-protocol`, `image-removal`, `long-token-url` |
| Live structure | `thinking-only`, `thinking-to-answer`, `tool-call-result`, `multi-text-block`, `multi-assistant-message`, `retry-stop`, `continuation-after-tool` |
| Recovery | `reconnect-in-text-block`, `resume-with-multiple-blocks`, `completion-checkpoint`, `final-reference-definition` |
| Interaction | `follow-scroll`, `scroll-away`, `return-to-bottom`, `lazy-markdown-settle` |

Do not cross-product all 38 fixtures with every transcript surface:

- Run Markdown completion, feature, and security fixtures once through the
  shared renderer in an answer row.
- Run live-structure and recovery fixtures with plain text or one small
  representative Markdown sample.
- Run a cross-surface sentinel set through thinking, interim, answer, and
  continuation rows. Include emphasis, a link, fenced code, and incomplete
  syntax. Test tool cards through their own structural and interaction
  contract.

This division must still prove that renderer, projection, and tool results are
not mistaken for each other.

## Main hypotheses and unknowns

### #34 hypotheses

- The server cadence is not the main cause for ordinary text updates because
  same-block events are already coalesced per socket.
- `reduceActiveGeneration` performs broad cloning for a local text change.
- `active-chat.ts`, `timeline-store.ts`, and `turn-rows.ts` cause
  transcript-wide reactive and projection work for a local text change.
- `transcript.tsx` schedules follow-scroll work for each live-generation
  update, including updates that do not change structure.
- Stable Solid row keys reduce DOM replacement but do not bound the work that
  creates the rows.

Unknowns include the exact Solid dependency invalidation order, the share of
time spent in clone versus projection versus Markdown, and the cost of
classification when a generation contains many blocks and tools.

### #24 hypotheses

- The current renderer performs cumulative parse and sanitisation work on each
  live source update, even when DOM reconciliation preserves node identity.
- Naive parser-safe chunking and delimiter-escaped tails on Marked were
  previously rejected as visibly unstable. That rejection does not forbid a
  **typed** streaming presentation layer: classify the unstable tail as
  pending math, fence, or other construct, render the stable prefix normally,
  and never paint raw open delimiters as prose. Slice 6b tests that narrower
  claim.
- Incremark may reduce cumulative parser work through block boundaries and
  stable block IDs, but its documented raw-HTML mode and built-in rendering
  options do not prove Conduit security or artifact compatibility.
- An incremental renderer may improve parser cost while changing output timing,
  DOM identity, link controls, code rendering, KaTeX, or final reconciliation.

### #24 measured finding — incomplete math (pre-Slice 6b)

Probed against pinned `@incremark/core@1.0.2` with `{ gfm: true, math: true }`:

- Open fenced code (` ```js\n… ` without closer) becomes a **pending** block
  whose node type is already `code` with fence markers stripped. The adapter
  can render artifact chrome without showing backticks. Fences are largely
  handled by the core.
- Open block math (`$$\Delta x, \Delta p \ge` without closer) becomes a
  **pending** block whose node type is still `paragraph` and whose text still
  contains the raw `$$…` source. Only a *closed* `$$…$$` promotes to
  `type: "math"`. Open inline `$…` likewise stays paragraph text.
- `mathPlugin` in `@incremark/core` is a **typewriter** plugin
  (`match` / `countChars` / `sliceNode` on already-parsed `math` /
  `inlineMath` nodes). It is not incomplete-delimiter handling and is unused
  by the Conduit adapter.
- The Slice 6 adapter calls `parser.getAst()` and renders every node,
  including pending paragraph text that still holds raw `$$`. That is an
  **adapter presentation failure**, not a missing dual-renderer hook. Core
  isolates the unstable tail as `pending`; it does not classify open math or
  suppress delimiter glyphs. Expecting ChatGPT-like math streaming from
  `getAst()` alone was wrong.

Marked has the same user-visible failure for a different reason: batch
`marked-katex-extension` only matches closed delimiters, so open `$$` falls
through as text on every streaming reparse. The `streaming` prop is currently
a data attribute only.

Unknowns remaining after this finding: holdback rules that stay stable for
currency `$`, nested fences, and finalized truncated math after stop; whether
progressive KaTeX on pending interiors flickers; reference definitions,
custom artifact controls, sanitisation boundaries, stable node identity, and
production bundle impact.

## Plausible approaches

### State and projection approaches for #34

1. **Per-block mutable accessors with structural records.** Keep generation,
   message, block, and tool identity in structural records. Give each live
   block its own text and status accessor. Update only the addressed block for
   ordinary deltas. Rebuild structure only at boundaries. This is the primary
   candidate because it matches the issue scope and preserves serializable
   resume snapshots.
2. **Immutable generation with targeted selectors.** Keep the current reducer
   shape but expose selectors that update only the changed block and cache
   projection results. This reduces API change but may retain broad cloning
   and invalidate Solid dependencies unless identity boundaries are exact.
3. **Mutable central map with derived snapshots.** Store blocks by stable ID and
   derive a full generation snapshot only for resume and completion. This may
   minimize ordinary-delta work but increases ownership and serialization risk.

The block-granular representation is client-owned. Keep
`src/active-generation.js` framework-free and preserve its plain-data reducer
for `PiManager`, Resume State, slow-reader recovery, protocol tests, and
serialization. A worker may extract framework-free event or patch semantics
that both reducers share, but must not put Solid primitives into the server
state owner.

Use Slice 1 evidence to choose the smallest client design. Prototype the first
approach by default. Use the second only if the first cannot preserve snapshot
equivalence or creates a larger ownership change than the evidence justifies.
Do not build two complete prototypes merely to compare them. Do not choose the
third without evidence that the snapshot boundary remains reliable.

### Renderer approaches for #24

1. Keep Marked and improve measurement or targeted reconciliation if parser
   cost is not the dominant cost.
2. Add an incremental streaming layer only for live content, then use the
   current Marked path for final or unsupported content. This requires a
   proven semantic and security fallback boundary.
3. Adopt Incremark as the live and final renderer only after the compatibility,
   security, identity, visible-cadence, and bundle gates pass and the owner
   approves the replacement.

Do not infer a renderer choice from #34 results. Test renderer candidates with
   equivalent state and delivery inputs.

## Ordered implementation slices

The first four slices belong to #34. The following slices belong to #24.
They may share fixtures and telemetry helpers, but each slice has a separate
commit, acceptance statement, and issue update.

### Slice 0 — Inflight plan and tree guard

This document is the review point. Preserve unrelated working-tree changes.
Before changes to more than three files, record the approved scope in this
document and obtain owner approval.

Acceptance: the plan names the causal path, evidence contract, separate issue
layers, ordered slices, risks, unchanged behavior, and non-goals.

Verification: review this document against both issue bodies and
`docs/operations/testing.md`. No runtime behavior changes.

### Slice 1 — Diagnostic baseline and semantic browser comparator (#34/#24)

Add only narrow measurement support. Extend the deterministic browser harness
so rich Markdown compares the structural fingerprint and explicit behavior
assertions defined above, not raw or normalized `textContent`. Add counters and
timings for reducer, projection, Markdown, reconciliation, DOM identity,
scroll, frames, and Long Tasks. Gate telemetry before timer calls and
allocations. Keep it redacted and opt-in to the instrumented harness.

Worker boundary: instrumentation, the deterministic comparator, fixtures, and
reports only. Do not change state ownership, timeline projection, renderer
output, protocol, or user-visible behavior. Stop after the Slice 1 review
handoff.

Acceptance:

- Existing plain, burst, high-TPS, reconnect, and final-content baselines stay
  unchanged.
- Rich Markdown fixtures complete and report structural semantic equality plus
  the required security and interaction assertions.
- Counters distinguish #34 state/projection work from #24 renderer work.
- One paired run reports instrumentation overhead, and bundle baselines come
  from the uninstrumented production build.
- No production behavior changes.

Verification: `npm test`, `npm run typecheck`, the transport harness, the
deterministic browser harness, and manual agent-browser checks for stream,
scroll-away, return-to-bottom, code copy, and external-link confirmation.

Commit: `test: instrument streaming state and renderer baseline`.

Slice 1 result, recorded on 3 August 2026:

- Slice 1 added measurement and regression evidence; it did not optimize the
  streaming path. Its purpose was to locate repeated per-delta work and make
  later performance changes reject semantic, security, identity, scroll, or
  reconnect regressions.
- In the final rich-Markdown run, 31 delivered text deltas caused 38 reducer
  runs, 38 full timeline projections, 30 Markdown renders, and 30 DOM
  reconciliations. Only one block and one row changed. The paired run observed
  31 Markdown renders and reconciliations for the same 31 deltas. These counts
  show that a local block update still fans out through client projection and
  accumulated Markdown work; they do not yet prove which stage dominates
  end-to-end time.
- Commit `024ce4c` adds compile-time and runtime telemetry gates. The normal
  production build returns before timer calls, metric allocation, recorder
  calls, browser observers, and frame sampling.
- Client metrics separate reducer and projection work from Markdown parse,
  KaTeX, sanitisation, and DOM reconciliation work. They report event scope,
  changed-block and changed-row cardinality, reference changes, duration, and
  structural-boundary types without transcript bodies.
- The browser report now contains a salted structural fingerprint, semantic
  node counts and identity, DOM mutation categories, scroll distance and
  programmatic writes, frame gaps, Long Tasks, security checks, and interaction
  results. It fails on fingerprint truncation and missing fixture contracts.
- Nine named fixtures cover rich Markdown, incomplete syntax, incomplete
  references, KaTeX, unsafe input, fenced-code copy, external-link
  confirmation, scroll, and reconnect. All nine passed. The KaTeX fixture
  recorded 19 `renderToString` calls. Reconnect used two sockets and one Resume
  State, recovered final content, and reported zero duplicate characters.
- One paired rich-Markdown run preserved the same structural result. The
  instrumented run completed 7.9 ms after the instrumentation-off run in that
  sample. The off run collected only its final correctness result, so it did
  not claim frame, mutation, scroll, or first-visible measurements.
- `npm run typecheck`, all 259 tests, `git diff --check`, and
  `VITE_CONDUIT_HARNESS=0 npm run build` passed. The uninstrumented build
  measured 125,191 bytes gzip for initial JavaScript and 103.97 kB gzip for the
  Markdown lazy chunk.
- Agent-browser authenticated against the managed app at
  `127.0.0.1:4310`. An existing long transcript preserved headings and
  Markdown content. Copy Markdown changed to `Copied`. The viewport moved
  19,748 px from the bottom and returned to zero. An existing fenced-code
  control accepted a copy action. An existing repository chat contained one
  fenced-code artifact and one external-link control. The link opened the
  `Open external link?` confirmation dialog. The page reported no console or
  browser errors. The normal app exposed four Markdown roots and no
  `window.__conduitHarness`, which confirms the production telemetry gate.
- Manual QA did not send a provider prompt or change transcript data.
  Deterministic fixtures prove live cadence, scroll-follow, external-link,
  clipboard, security, and reconnect behavior.

The evidence supports Slice 2: move client updates to the addressed block,
then compare the same counts and fixtures. Slice 1 meets its diagnostic
acceptance criteria. It changes measurement and test support only; it does not
approve a new state owner or renderer.

### Slice 2 — Client-owned block-granular live state (#34)

Prototype per-block live text and status accessors behind stable structural
generation and block records. Ordinary deltas update the addressed block.
Structural events update arrays and boundary metadata. Keep a serializable full
client snapshot that remains equivalent to the shared plain-data reducer.

Worker boundary: client live-generation state and focused reducer/store tests
only. Do not change `PiManager`, wire events, Resume State, checkpoint behavior,
timeline projection, scrolling, or Markdown. If the client needs shared event
semantics, keep that extraction framework-free and prove the server reducer is
unchanged.

Acceptance:

- A delta changes only the addressed block accessor.
- Unchanged generation, message, block, tool, and structural array references
  stay stable where the event is local.
- After every fixture event, not only at settlement, the client snapshot is
  deeply equivalent to the shared reducer output.
- Sequence handling, resume, duplicate suppression, retry, stop, and
  multi-block ordering remain correct.

Verification: pure reducer/store tests with reference-identity assertions;
resume and boundary tests; browser harness counters; and a state benchmark that
varies accumulated block text and active message/block/tool count independently.
Each axis uses at least three sizes selected after Slice 1; hold other axes
fixed and report changed accessor count, reference churn, work count, and
duration.

Commit: `perf: make live generation updates block-granular`.

### Slice 3 — Narrow timeline projection (#34)

Make the timeline owner cache structural rows and update only the live message,
trace segment, tool segment, or classification affected by a changed block.
Keep stable row keys and the current live-to-final reconciliation contract.

Worker boundary: timeline ownership, live-row projection, direct dependants,
and scroll scheduling only. Do not change protocol, server state, client event
semantics, Markdown parsing, sanitization, or visible classification rules.

Acceptance:

- Ordinary text deltas do not rebuild the full timeline structure.
- Projection work per delta is bounded by the changed block and its direct
  dependants.
- Thinking, narration, interim, answer, tool, and continuation classification
  remains correct.
- Outer live response nodes and unrelated rows retain identity.

Verification: row-projection unit tests; projection counters; browser mutation,
row-key, persistent-node, and frame measurements; existing navigation and
scroll tests; and a projection benchmark that varies persisted row count and
active message/block/tool count independently. An ordinary delta must not scan,
join, classify, or replace unrelated rows or active blocks.

Commit: `perf: update timeline rows by changed live block`.

### Slice 4 — #34 boundary and recovery verification

Exercise new assistant messages, thinking-to-text transitions, tool calls and
results, multiple text blocks, retry and stop, reconnect resume, completion
checkpoint reconciliation, follow-scroll, scroll-away, and return-to-bottom.
Retain the current Marked renderer.

Worker boundary: fixtures, tests, reports, and narrow fixes for regressions
introduced by Slices 2 or 3. Do not add renderer work or broaden the protocol.
If a failure requires an architectural change, stop and return it to the
responsible slice.

Acceptance:

- Structural work occurs at the documented boundaries.
- Ordinary deltas meet the bounded projection target without changing visible
  output cadence or final persistence.
- Reconnect and checkpoint paths produce one final semantic transcript with no
  duplicate or missing content.
- User scroll-away behavior is not overridden by live updates.

Verification: deterministic transport and browser reports, agent-browser
manual interaction, full unit/typecheck/build checks, and promoted Playwright
canaries only if the release path requires them.

Commit: `test: verify block-granular live transcript boundaries`.

### Slice 4 result — 4 August 2026

The existing Pi RPC fixtures and browser canaries already covered the Slice 4
boundaries, so no production or harness code change was required. The focused
state and projection run passed 26 tests. It covered thinking-to-answer
classification, tool and parallel-tool ordering, multiple native text blocks,
retry, stop, duplicate suppression, resume during thinking and answer,
checkpoint races, and direct row projection. The client state snapshot stayed
equivalent to the shared reducer after every event in every fixture.

The full unit command did not complete cleanly. It reported 266 passing tests
and one failing test. The verbatim failure was:

```text
Error: Test "PTY manager starts a terminal only with a server-resolved absolute working directory" at test/pty-manager.test.js:22:1 generated asynchronous activity after the test ended. This activity created the error "Error: ENOENT: no such file or directory, rename '/tmp/conduit-pty-manager-q8YcYG/remotes.json.63889.660bc616-8db3-4bb7-ada9-d118491fac59.tmp' -> '/tmp/conduit-pty-manager-q8YcYG/remotes.json'" and would have caused the test to fail, but instead triggered an unhandledRejection event.
✖ test/pty-manager.test.js
```

The failure is outside the Slice 4 event and transcript path. The focused
command `node --test test/active-generation.test.js test/timeline-projection.test.js test/turn-rows.test.js test/live-events.test.js` passed all 26 tests. `npm run typecheck` passed.

The deterministic transport checks passed with final-text parity:

- `slice4-boundary-steady`: 16 source deltas, 9 delivered frames, 7 coalesced
  deltas, 0 source stalls, and 0 delivery gaps over 100 ms.
- `slice4-boundary-burst`: 29 source deltas, 6 delivered frames, 23 coalesced
  deltas, 5 intentional 128 ms source stalls, and 57 final characters.

The deterministic browser checks passed on Chromium 149. The rich fixture
delivered 31/31 deltas, kept one outer Markdown node, recorded 7 full and 31
narrow projections, 0 frame gaps over 32 ms, and 0 Long Tasks. The reconnect
fixture used 2 sockets and 1 Resume State, recovered 26 characters, and
reported 0 duplicate characters. The 630-character scroll fixture ended at
distance 0 from the bottom with 0 Long Tasks; its burst input recorded 2 frame
gaps over 32 ms and none over 50 ms.

`CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build` passed. It measured
232,322 bytes gzip for initial JavaScript, 27,736 bytes gzip for CSS, and
185,187 bytes gzip for the largest lazy JavaScript chunk. The normal 180,000
byte initial-JavaScript budget remains the known Slice 6 failure; this check did
not change that threshold.

The managed server was restarted with
`bash .devcontainer/start-conduit.sh restart`. `/healthz` returned ready and
the listener was `0.0.0.0:4310`. Agent-browser manual checks used the retained
Marked renderer. An existing chat expanded to seven completed tool cards and
retained headings, a table, and fenced-code controls. Scrolling away measured
2,831 px from the bottom; `Scroll to latest` returned the distance to 0. A
disposable live prompt settled to `OK` with Marked selected. The browser
reported no page errors or console errors.

Verdict: Slice 4 passes its boundary, recovery, identity, persistence, and
scroll acceptance based on the existing fixture coverage. The unrelated PTY
cleanup failure remains open and is not fixed in this slice.

### Manual validation checklist — Slice 4

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310` from Windows, and use an authenticated disposable chat.
Keep the Markdown renderer set to `Marked`. Record each item as pass or fail.

- Send a prompt that causes thinking, at least one tool call, and a final
  answer. Confirm the trace, tool card, tool status, and answer remain in the
  supplied order. Text must not duplicate or disappear.
- Expand and collapse the completed trace. Confirm all thinking, interim text,
  tool cards, and the final answer remain present. Tool completion must not
  replace the trace row or move the answer.
- During a response, check the transition from thinking to answer and any
  second assistant text block. The answer must not remain on `Thinking…`.
- Stop a partial response. Confirm late text does not appear after the stop.
  Retry a transient failure if the runtime exposes the retry control; confirm
  the recovered answer is one response.
- Refresh or let the WebSocket reconnect during thinking, a tool call, and the
  answer. Confirm one final transcript with no duplicate or missing content.
- Scroll away during a long response. Confirm new output does not force the
  viewport to the bottom. Use `Scroll to latest` and confirm distance from the
  bottom returns to zero.
- Check code-copy, external-link confirmation, and the browser console. The
  normal build must not expose `window.__conduitHarness`.

Expected result: structural boundaries update the affected trace, tool, or
answer rows; ordinary text keeps the narrow update path; reconnect and
checkpoint recovery preserve one final answer; and user scroll-away behavior
remains unchanged.

### Slice 5 — Renderer-specific Marked baseline (#24)

Use the instrumented harness to isolate Marked, KaTeX, DOMPurify, and DOM
reconciliation work from state and projection. Run the full Markdown fixture
matrix with identical cumulative source and delta sequences.

Worker boundary: measurement and fixtures only. Do not change renderer output
or state/projection ownership. Stop after the baseline report and review.

Acceptance:

- Parse, sanitisation, reconciliation, DOM mutation, semantic-node identity,
  visible cadence, frame gaps, Long Tasks, and final semantic content are
  reported separately.
- The baseline covers incomplete syntax, tables, fenced code, KaTeX,
  references, links, long tokens, thinking/tool presentation, reconnect, and
  checkpoint completion.
- Security behavior matches the current contract.

Verification: deterministic browser harness plus the existing Markdown browser
coverage; agent-browser for external-link, unsafe-link, artifact, and scroll
interaction. Do not use subjective smoothness as a gate.

Commit: `test: establish Markdown renderer performance baseline`.

### Slice 5 result — 4 August 2026

The current Marked renderer passed the complete nine-fixture browser matrix:
`rich-markdown`, `incomplete-syntax`, `incomplete-reference`, `katex`,
`security`, `code-copy`, `external-confirmation`, `scroll`, and `reconnect`.
Every run reported `outcome: passed`, structural parity, persistent outer
Markdown identity, and no browser errors. The stream fixtures used the same
cumulative source and delta sequence for the measurement below; reconnect was
run through its separate two-socket recovery path.

Representative baseline measurements on Chromium 149:

- Rich Markdown: 91 source characters, 31 deltas, 33 Markdown renders, 47 DOM
  mutations, parse p95 2.6 ms, sanitisation p95 1.2 ms, reconciliation p95
  0.2 ms, 2 frame gaps over 32 ms, 1 over 50 ms, and 0 Long Tasks.
- Long scroll: 630 source characters, 210 deltas, 212 Markdown renders, 218
  DOM mutations, parse p95 0.2 ms, sanitisation p95 0.4 ms, reconciliation p95
  0.1 ms, 0 frame gaps over 32 ms, and 0 Long Tasks. The final distance from
  the bottom was 0.
- KaTeX: 43 source characters, 15 deltas, 16 Markdown renders, parse p95 9.8
  ms, sanitisation p95 2.2 ms, reconciliation p95 0.2 ms, 1 frame gap over 32
  ms, and 0 Long Tasks.
- Security: 99 source characters, 33 deltas, 35 Markdown renders, 52 DOM
  mutations, parse p95 2.0 ms, sanitisation p95 1.6 ms, reconciliation p95
  0.1 ms, 4 frame gaps over 32 ms, 0 over 50 ms, and 0 Long Tasks. Unsafe
  elements, unsafe protocols, and images remained absent.

The code-copy and external-confirmation fixtures passed their interaction
assertions. The reconnect fixture used 2 sockets and 1 Resume State, retained
the outer node, recovered 26 characters, and reported 0 duplicate characters.
The baseline is a measurement record, not a performance gain: Marked still
performed cumulative Markdown work for the live source, while Slice 2 and
Slice 3 counters separately recorded reducer and projection work.

The same run used the existing current-renderer metrics. For rich Markdown,
the client recorded 38 reducer and projection samples, 7 full projections, 31
narrow projections, 33 Markdown renders, and 33 reconciliations. For the long
scroll fixture, it recorded 217 reducer and projection samples, 7 full
projections, 210 narrow projections, 212 Markdown renders, and 212
reconciliations. These figures are the Marked comparison inputs for the Slice 7
decision; they do not compare against the failed high-level Incremark wrapper.

The build and managed-server evidence remains the Slice 4 record: the build
passed with the documented temporary budget override, the source server bound
to `0.0.0.0:4310`, and the managed health response was ready. Agent-browser
manual checks with Marked found one code-copy control, one external-link
control, eight headings, and one table. The external-link control opened
`Open external link?`; Cancel closed it. No page or console errors occurred.

Verdict: Slice 5 establishes a repeatable current-renderer baseline with
separate parser, sanitisation, reconciliation, DOM, cadence, identity,
security, and recovery evidence. It shows no renderer performance improvement;
the Slice 6 candidate gate remains rejected pending the Slice 7 decision.

### Manual validation checklist — Slice 5

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310` from Windows, and use an authenticated disposable chat.
Keep the renderer set to `Marked`. Record each item as pass or fail.

- Stream short and long responses. Check first visible text, visible cadence,
  incomplete Markdown, headings, lists, tables, fenced code, and KaTeX. Look
  for missing text, duplicated text, blank output, or layout jumps.
- Use an unsafe HTML element, an unsafe URL protocol, and an image in a test
  response. Confirm none renders or executes. Use an external link and confirm
  `Open external link?` appears; Cancel must not open a tab.
- Use `Copy code` on a fenced block. Confirm the clipboard contains the code and
  the control remains usable after another response.
- During thinking, tool execution, and final answer phases, expand the trace.
  Confirm tool cards, thinking text, interim text, and answer Markdown retain
  order and identity.
- Scroll away during a long response. Confirm live output does not force the
  viewport to the bottom. Return to the latest position and confirm zero
  distance from the bottom.
- Refresh or reconnect during a response and after completion. Confirm one
  final semantic answer with no duplicate or missing content.
- Check the browser console. Confirm a normal build does not expose
  `window.__conduitHarness`.

Expected result: Marked remains semantically and behaviorally stable. This
checklist validates the baseline contract; it does not use subjective
smoothness as a gate.

### Slice 6 — Incremark compatibility spike and local switch (#24)

Use a temporary fixture outside the production dependency graph to test
`@incremark/solid@1.0.2` through its high-level content/stream API and to test
`@incremark/core@1.0.2` through its lower-level append/finalize API. Use the
same deterministic fixtures as Slice 5. Record package metadata, dependency
size, and generated chunk estimates in the report output. The report is
temporary; this file is the durable progress record.

The managed application also has a local-only renderer selector. It follows
the terminal renderer pattern: the default is Marked,
`?markdownRenderer=incremark` selects the candidate for a local route, and the
selector stores the local choice in `localStorage`. It is visible only on local
development hosts or when the query parameter is present. The candidate is a
Conduit adapter around `@incremark/core`; it is not the published
`@incremark/solid` component.

Worker boundary: the temporary fixture, its harness, the local candidate
adapter, the local selector, and this evidence record. Do not replace the
default renderer or change server/protocol behavior. Pin the tested package
versions in the report. Record package provenance, license, release date, and
transitive dependency sizes.

Acceptance:

- Immediate styled output has no visible completion or block-boundary churn.
- GFM tables, lists, fenced code, KaTeX, reference definitions, links, long
  tokens, and incomplete Markdown match the current semantic contract.
- Artifact controls, thinking/tool rows, reconnect resume, completion
  reconciliation, follow-scroll, and stable outer and semantic DOM nodes work.
- Security matches the current behavior: no unsafe HTML or URL execution,
  images remain removed, external links retain confirmation, and artifacts
  retain their controls.
- Renderer work and bundle impact improve enough to justify further work, or
  the failed gate is recorded with evidence.
- The managed `4310` route can switch between Marked and the candidate, and the
  default remains Marked after a fresh session.

Verification: same deterministic fixture inputs as Slice 5, semantic DOM
comparison, security assertions, identity assertions, frame/Long Task reports,
manual agent-browser interaction, `npm run typecheck`, a production build with
the documented bundle budget, and a managed-server restart. The local switch
must be checked from `127.0.0.1:4310`; the server must bind to `0.0.0.0`.

Commit: `test: spike Incremark compatibility for streaming Markdown`.

### Slice 6 benchmark and implementation notes — 3 August 2026

The temporary harness ran 9 fixtures in content and stream modes, for 18
browser runs, plus 9 lower-level parser runs. The current-renderer baseline
passed all 18 contract checks. The published `@incremark/solid@1.0.2` candidate
raised a runtime error in all 18 runs. The first error was:

```text
TypeError: Cannot read properties of undefined (reading 'url')
```

It came from the package's reference-image branch while rendering a fixture
that had no reference definition. The code fixture also exposed a separate
highlighter error. The candidate therefore has zero of 9 stream parity runs,
zero runtime-error-free runs, and the gate is not promising.

The lower-level core parser preserved the complete source buffer in all 9
fixtures. It accepted 31 chunks for the rich fixture and 210 chunks for the
scroll fixture. The maximum update contained 2 blocks for rich Markdown and 1
block for the long scroll fixture. This shows incremental parser boundaries;
it does not prove lower end-to-end rendering cost.

Package evidence for the pinned 13 March 2026 release:

- `@incremark/core@1.0.2`: MIT, 197,789-byte tarball, 882,904-byte unpacked
  payload, 22 direct dependencies.
- `@incremark/solid@1.0.2`: MIT, 72,168-byte tarball, 304,493-byte unpacked
  payload, 8 direct dependencies.
- The isolated graph contained 127 packages and 31,492,361 installed bytes.
  The largest payload was `@shikijs/langs` at 8,041,828 bytes.
- The isolated high-level candidate bundle was 1,945,949 bytes gzip versus
  101,870 bytes gzip for the baseline fixture: +1,844,079 bytes gzip. This is
  a package-cost measurement, not a production bundle claim, because the
  high-level candidate failed at runtime.

The working-tree local adapter imports only `@incremark/core` and lazy-loads
as `incremark-markdown-*.js`: 84.31 kB raw and 24.62 kB gzip in the
production build. The default Marked path stays in the existing application
chunk. This is a measurable lazy-load cost, not a measured performance gain.
The default `npm run build` also reports the existing initial-JS budget failure:
`initial JS is 232322 B gzip; budget is 180000 B.` The source build completes;
the budget check exits non-zero. No threshold was changed.

Managed-server verification passed after `bash .devcontainer/start-conduit.sh
restart`: `/healthz` returned `{"ok":true,"status":"ready","release":"development"}`
and `ss` showed `0.0.0.0:4310`. Authenticated agent-browser verification selected
Incremark, showed the existing heading/table/code content, switched back to
Marked with the same structure, and loaded the candidate from
`?markdownRenderer=incremark`.

The final managed-server smoke sent one disposable `Reply exactly OK.` prompt
with Incremark selected. The candidate assistant root streamed and settled to
`OK`; the renderer attribute remained `incremark`, no generation-stop control
remained, and no alert error was present. The browser session was then closed.

### Manual validation checklist — Slice 6

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310`, and use an authenticated disposable chat. Record each
item as pass or fail.

- In a fresh browser session, confirm the selector says `Marked`. Confirm the
  normal response layout has not changed.
- Select `Incremark`. Check headings, paragraphs, lists, tables, fenced code,
  KaTeX, incomplete Markdown, and long responses. Look for missing text,
  duplicated blocks, unstyled output, layout jumps, or a blank answer.
- During a live response, check thinking text, tool cards, trace expansion,
  answer growth, follow-scroll, and scroll-away behavior. The candidate must
  not leave the trace stuck on `Thinking…`.
- Use a code block. `Copy code` must copy the block contents. Use an external
  link. The existing confirmation dialog must open, and Cancel must not open a
  new tab. Unsafe HTML, unsafe URL protocols, and images must not render.
- Refresh or reconnect during streaming and after completion. Confirm one
  final answer with no duplicate or missing text.
- Select `Marked` again. Confirm the same response remains visible, the
  existing external-link and copy controls work, and no console-visible error
  or blank renderer remains.
- Load `http://127.0.0.1:4310/?markdownRenderer=incremark` in a new tab. Confirm
  the selector and `data-markdown-renderer` use `incremark`; then select
  `Marked` and confirm the local choice persists.

Expected result: the switch is reversible and local, Marked remains the safe
default, candidate output is usable for the spike, and no protocol, persistence,
tool-row, scroll, security, or interaction regression is visible.

### Slice 6a — Renderer A/B performance benchmark (#24)

Compare the current Marked renderer with the local Incremark-core adapter before
implementing Slice 6b. Use the same browser, fixture, cumulative source, delta
sequence, cadence, and instrumentation settings for both renderers. Run the
representative rich, scroll, KaTeX, security, code-copy, external-link,
incomplete-syntax, incomplete-reference, and reconnect fixtures. Repeat the
representative rich, scroll, and KaTeX cases to expose timing noise.

Worker boundary: renderer selection in the deterministic browser harness,
Incremark adapter telemetry, the A/B runner, and this evidence record. Do not
change Markdown semantics, state ownership, protocol, scroll behavior, or
incomplete-construct presentation.

Acceptance:

- Both renderers complete the same fixture contracts, or each incompatibility
  is reported with the exact fixture and error.
- Parse/render work, DOM mutation count, outer and semantic node identity,
  first-visible time, completion time, visible increments, frame gaps, Long
  Tasks, scroll distance, and final semantic parity are reported per renderer.
- The result uses repeated comparable runs and reports medians or distributions;
  one noisy run cannot establish a performance claim.
- Bundle cost and parser-only measurements remain separate from browser render
  measurements.

Verification: run the A/B harness before agent-browser. Use the managed server
only for a short manual parity check after the deterministic comparison. Record
the exact command, renderer, fixture, run count, browser/runtime, and result.

Commit: `test: benchmark Marked and Incremark renderers`.

### Slice 6a result — 4 August 2026

Command executed:

```text
node scripts/run-renderer-benchmark.mjs --runs 2
```

The runner used the same Chromium `149.0.7827.55`, Node `v24.18.0`, steady
16 ms cadence, 3-character deltas, seed `1`, and nine named fixtures for both
renderers. It performed 36 sequential browser runs: 18 Marked and 18
Incremark. The A/B report was generated in memory and is not a durable result
file; these numbers are the durable record.

The result is **not a measured Incremark performance improvement**:

| Fixture | Completion p50 Marked → Incremark | First-visible p50 Marked → Incremark | DOM mutations Marked → Incremark | Incremark contract |
| --- | ---: | ---: | ---: | --- |
| `rich-markdown` | 529.0 → 536.5 ms (+1.4%) | 19.6 → 73.2 ms (+273.5%) | 47 → 86 (+83.0%) | 2/2 passed |
| `katex` | 270.0 → 285.4 ms (+5.7%) | 30.4 → 81.2 ms (+167.1%) | 25 → 32 (+28.0%) | 2/2 passed |
| `security` | 547.8 → 568.2 ms (+3.7%) | 34.6 → 181.3 ms (+424.0%) | 51 → 58 (+13.7%) | 2/2 passed |
| `scroll` | 3493.9 → 3507.8 ms (+0.4%) | 41.1 → 84.8 ms (+106.3%) | 217 → 423 (+94.9%) | 2/2 passed |
| `external-confirmation` | 228.2 → 226.9 ms (-0.6%) | 36.1 → 73.9 ms (+104.7%) | 36 → 31 (-13.9%) | 2/2 passed |

The first-visible penalty includes the Incremark adapter's lazy chunk load. It
is an actual cold-path cost of the current switch, not a parser-only result.
The completion result is near parity because the 16 ms source cadence and
browser delivery dominate these short fixtures. DOM work is worse for the
rich and scroll cases even when completion time is close. Incremark produced
two frame gaps over 32 ms on `scroll` versus zero for Marked; both renderers
reported zero Long Tasks and zero frame gaps over 50 ms in these runs.

Renderer timings do not show a general parser win. Incremark parse p95 was
57.1% slower on `rich-markdown`, 16.9% slower on `katex`, 350% slower on
`security`, and 50.0% slower on `scroll`. The measurements are not identical
work: Marked `parseMs` includes Marked plus DOMPurify, while Incremark `parseMs`
includes core append/render/finalize plus the AST snapshot. Browser completion,
DOM mutation, frame, Long Task, scroll, and contract results are the primary
cross-renderer evidence. Incremark's isolated KaTeX call p95 was 2.2 ms versus
Marked's 2.6 ms on `katex` (-15.4%), but the full fixture still completed 5.7%
slower and had one frame gap over 32 ms.

Both paths preserved the outer Markdown node in every passing run. Security
assertions, code-copy, external-link confirmation, final scroll distance, and
reconnect recovery passed for both paths. Structural counts passed for all
other fixtures. Incremark failed `incomplete-reference` in both runs with the
exact harness error `Rendered structural fingerprint did not match the
expected fixture`; its final semantic text length was still 34 characters.
The structural contract does not prove byte-for-byte textContent parity:
`rich-markdown` ended at 62 characters for Marked and 47 for Incremark, while
`katex` ended at 29 and 49. The adapters therefore remain behaviorally
different even where the count-based fixture contract passes.

Verdict: **do not claim an Incremark performance benefit and do not adopt it**.
Slice 6b may proceed as a presentation experiment on both maintained paths,
but it must not be justified as an Incremark speed improvement. The
`incomplete-reference` incompatibility and exact textContent differences remain
open risks for Slice 7.

### Manual validation checklist — Slice 6a

Run `bash .devcontainer/start-conduit.sh restart`, confirm the managed listener
is `0.0.0.0:4310`, and open `http://127.0.0.1:4310` from Windows. Use an
authenticated disposable chat. Record each item as pass or fail.

- Open the default route with no renderer query. Confirm the Markdown renderer
  remains Marked after a fresh load.
- Open `?markdownRenderer=marked`. Stream a rich answer containing a heading,
  list, table, fenced code, inline math, and a block equation. Confirm the
  answer completes once, the code copy button copies only code, math renders,
  and no console or page error appears.
- Open `?markdownRenderer=incremark` and repeat the same answer. Confirm the
  answer completes once, the code copy button and external-link confirmation
  still work, math renders, and no console or page error appears.
- With each renderer, stream the long scroll case. Scroll away before output
  arrives, then return to the bottom. Confirm the renderer does not jump to the
  wrong position and the final distance from the bottom is zero when following
  output.
- With each renderer, interrupt and reconnect a live answer. Confirm two
  visible segments do not duplicate characters and the answer ends with the
  same text.
- Inspect the incomplete reference case. Record the exact visible structure;
  Incremark is expected to differ here until the compatibility issue is fixed.
- Use the renderer switch control if present, then reload. Confirm the switch
  is reversible and the default still returns to Marked.

This checklist validates live parity and regressions. It cannot establish a
performance gain; use `node scripts/run-renderer-benchmark.mjs --runs 2` for
that claim.

### Slice 6b — Streaming incomplete-construct presentation (Marked + Incremark) (#24)

Close the raw-delimiter flash for live assistant Markdown on **both**
renderers without choosing a default-renderer winner. This is presentation and
fixture work on the existing dual path. It is not Slice 8 adoption.

#### Why this slice exists

Live answers currently show unclosed math and similar tails as source text
(for example `$$\Delta x, \Delta p \ge` in the paragraph). Chat-style UIs keep
delimiter syntax internal and show either nothing, pending chrome, or
progressive typeset for that span.

Slice 6 proved the Incremark adapter runs; it did not implement pending-tail
presentation. Core already separates `completed` vs `pending` and types open
fences as `code`, but open `$$` / `$` remain pending **paragraph text** with
delimiters intact. Painting `getAst()` wholesale therefore reproduces the
Marked failure mode for math. Marked needs an explicit streaming split because
it has no pending-block API.

#### Product contract (both renderers, `streaming === true`)

1. **Stable prefix** — closed constructs render exactly as today (GFM, KaTeX,
   artifacts, links, sanitisation).
2. **Unstable tail** — never paint open construct delimiters as ordinary prose.
   Minimum set:
   - unclosed block math `$$…`
   - unclosed inline math `$…$` when the opener is unambiguous under the same
     rules as `marked-katex-extension` / Incremark math (currency false
     positives must not eat whole paragraphs)
   - unclosed fenced code (Marked path; Incremark already types pending `code`)
   - keep existing incomplete emphasis/link/list/table behavior at least as
     good as baseline; do not regress it to gain math
3. **Pending presentation** — typed shell, not raw source:
   - math: pending math region; try KaTeX on the interior when it parses;
     otherwise empty or muted non-delimiter preview (no leading/trailing `$$`)
   - code: existing artifact chrome with growing body (no bare ` ``` `)
4. **Stream end / stop** — when `streaming` becomes false, run the full current
   finalize path (Incremark `finalize()`, Marked full source). Truncated math
   after stop may typeset best-effort or show a clean fallback; it must not
   remain stuck in pending chrome.
5. **Identity** — outer `.chat-markdown` node and already-completed semantic
   children keep identity across ordinary deltas; only the pending tail may
   replace itself.
6. **Non-goals** — no default-renderer switch; no `@incremark/solid`; no
   protocol, projection, or scroll ownership changes; no typewriter
   `BlockTransformer` adoption unless a measured gate demands it.

#### Implementation shape

Prefer one shared helper used by both adapters, for example
`splitStreamingMarkdown(source)` → `{ stable, pending }` with
`pending: null | { kind: "math-block" | "math-inline" | "fence"; language?; body }`.

| Path | Responsibility |
| --- | --- |
| Shared helper | Detect open fence / block math / inline math; identical classification rules; unit-tested without DOM |
| `MarkedMarkdown` | When `props.streaming`, parse only `stable` (or stable + synthetic closed forms if needed for structure); append pending chrome for `pending`; full source when not streaming |
| `IncremarkMarkdown` | Keep append/finalize. Render **completed** blocks as now. For **pending** blocks: if node is already `code`, existing artifact path; if `rawText` / paragraph text matches open math, pending math chrome instead of text; do not rely on `mathPlugin` (typewriter only). Still `finalize()` when `!streaming` |
| CSS | Pending math/code shells under `.chat-markdown[data-streaming]`; no layout jump larger than ordinary line growth |

Do not reintroduce untyped "escape the tail and hope" chunking. Classification
must be kinded and covered by fixtures.

#### Fixtures and harness

Add deterministic fixtures (same IDs on Marked and Incremark):

| ID | Source intent | Live assertion |
| --- | --- | --- |
| `incomplete-math-block` | Prose then `$$\Delta x, \Delta p \ge` without closer | No `$$` in visible textContent while streaming; zero or one pending-math node; after finalize with closer, one `.katex` block |
| `incomplete-math-inline` | Prose then open `$E=mc` | No lone opener `$` flash as math source; closes to inline KaTeX |
| `incomplete-fence` | Strengthen if needed | Artifact chrome while open; no bare fence markers in prose |
| `stopped-incomplete-math` | Stream ends with an open `$$` construct | No raw delimiter or pending chrome remains after `streaming` clears |
| existing `katex` / `incomplete-syntax` / `incomplete-reference` | Regression | Unchanged semantic contract when complete or non-math incomplete |

Harness must assert **during** streaming (mid-delta snapshot), not only on the
final string. Final-only checks hide this bug.

#### Worker boundary

- In scope: shared split helper; `markdown.tsx` / `incremark-markdown.tsx`
  streaming presentation; styles; fixtures; harness mid-stream assertions;
  unit tests for the helper; this file's Slice 6b result notes.
- Out of scope: default renderer change; Slice 7 decision text beyond linking
  evidence; server/protocol; timeline projection; enabling `BlockTransformer`
  typewriter by default.

#### Acceptance

- Mid-stream snapshots for `incomplete-math-block` and
  `incomplete-math-inline` show no raw open math delimiters in visible text on
  **both** Marked and Incremark.
- Closed `katex-inline-block` / `katex` fixtures still render KaTeX on both.
- Fenced-code copy, external-link confirmation, image removal, and unsafe
  protocol rejection remain green on both.
- Final content after stream end equals today's finalized semantics for the
  same full source (structural fingerprint + KaTeX present when source is
  closed).
- Stop mid-math does not leave pending chrome after `streaming` clears.
- No new Long Task or frame-gap regression beyond noise on the rich and scroll
  fixtures; report numbers next to Slice 5/6 baselines.
- Default remains Marked; Incremark stays opt-in local switch.

#### Verification

- Unit: shared split helper table (open/closed block math, inline math,
  fence, currency `$5`, escaped and nested cases you can define without
  guessing undocumented parser behavior).
- Deterministic browser harness: new fixtures mid-stream + final; existing
  rich/katex/code-copy/security/scroll/reconnect on both renderers.
- `npm run typecheck`, focused unit tests, production build (record budget;
  do not silently raise it).
- Managed `4310` agent-browser: one live math-heavy prompt on Marked and on
  Incremark; confirm no raw `$$` flash; switch renderer and recheck.

#### Slice 6b result — 4 August 2026

Implemented `splitStreamingMarkdown(source)` in
`conduit-web/src/client/chat/streaming-markdown.ts`. It classifies the first
unstable tail as `math-block`, `math-inline`, or `fence`, and returns the
stable source prefix plus the delimiter-free body. Currency `$5`, escaped
dollars, code spans, closed fences, and closed math remain stable input.

Both adapters use the same classifier. Marked parses the stable prefix and
adds a sanitised pending shell. Incremark continues to use `append()` and
`finalize()` for the full parser state, while a presentation AST omits the
pending tail until it closes. Both paths try KaTeX on a pending interior and
fall back to muted, delimiter-free text. An ended stream removes the pending
attribute; an invalid truncated formula uses the final muted fallback. The
outer `.chat-markdown` node remains stable. The Marked reconciler now treats
the renderer-owned `data-streaming-pending` and `data-streaming-final`
attributes as managed attributes, so a pending node cannot retain stale state.

The deterministic browser harness records redacted mid-delta snapshots. The
new `incomplete-math-block`, `incomplete-math-inline`, and `incomplete-fence`
fixtures passed on both renderers. Each open-construct window had zero raw
delimiter samples and one pending node; each closed fixture ended with its
expected KaTeX or artifact structure. The
`stopped-incomplete-math` fixture passed on both renderers with
`finalPendingNodeCount: 0` and no raw delimiter samples after stream end.

The focused commands were:

```text
node --test test/streaming-markdown.test.js
npm run test:harness:browser -- --fixture <fixture> --renderer <marked|incremark> --profile steady --chunk-size 3 --seed 1
```

All new fixtures passed for both renderers. The regression set also passed for
both renderers: `katex`, `incomplete-syntax`, `code-copy`,
`external-confirmation`, `security`, `scroll`, and `reconnect`. The known
Incremark `incomplete-reference` incompatibility remains unchanged: Marked
passed, while Incremark failed with the exact error
`Rendered structural fingerprint did not match the expected fixture`.

The repeated rich and scroll A/B run used Chromium `149.0.7827.55`, Node
`v24.18.0`, steady 16 ms cadence, 3-character deltas, seed `1`, and two runs
per renderer and fixture:

| Fixture | Completion p50 Marked → Incremark | First-visible p50 Marked → Incremark | DOM mutations Marked → Incremark | Frame gaps over 32 ms | Frame gaps over 50 ms | Long Tasks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `rich-markdown` | 535.0 → 538.0 ms (+0.6%) | 33.2 → 93.9 ms (+182.8%) | 46 → 86 (+87.0%) | 0 → 2 | 0 → 0 | 0 → 0 |
| `scroll` | 3521.2 → 3520.9 ms (-0.01%) | 47.2 → 89.0 ms (+88.6%) | 217 → 419 (+93.1%) | 0 → 2 | 0 → 0 | 0 → 0 |

The current Marked numbers remain within the Slice 5 baseline noise. The
current Incremark result remains near completion parity but has a cold first
paint penalty, more DOM mutations, and two frame gaps over 32 ms on both
representative fixtures. No renderer reported a Long Task or a frame gap over
50 ms in this repeat. Slice 6b therefore fixes the visible incomplete-tail
contract on both paths but does not change the Slice 6a decision: it provides
no evidence that Incremark is faster.

Verification completed:

- `node --test test/streaming-markdown.test.js`: 7 passed.
- `npm test`: 273 passed.
- `npm run typecheck`: passed.
- `npm run build`: Vite completed, then the existing budget gate failed with
  `initial JS is 233528 B gzip; budget is 180000 B.`
- `CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build`: passed. The report was
  initial JS `233528 B gzip`, initial CSS `27848 B gzip`, and largest lazy JS
  `185186 B gzip`. No budget was changed. The initial JS increase from the
  recorded Slice 6a build is about `1206 B gzip`.
- Managed restart: `bash .devcontainer/start-conduit.sh restart`; health was
  `{"ok":true,"status":"ready","release":"development"}` and `ss`
  reported `0.0.0.0:4310`.
- Authenticated agent-browser on the managed server passed a live formula
  prompt with Marked and again with Incremark. Each run reported one `.katex`
  node, zero raw-delimiter samples, zero pending nodes after completion, and
  no page or console error. The selector switched to Incremark and back; a
  fresh session still selected Marked.

Verdict: Slice 6b meets its presentation acceptance on both maintained paths.
It is not renderer adoption evidence. Keep Marked as the default and carry the
known Incremark reference-definition incompatibility into the Slice 7 decision.

Commit: `fix: hide incomplete math and fence tails while streaming`.

#### Slice 6b presentation refinement — 4 August 2026

The pending math shell now stays empty and invisible. It does not call KaTeX,
show `Math in progress`, or expose partial TeX. Display math reserves a fixed
`2.2em` block. Inline math reserves a zero-width, one-line slot. Completed
KaTeX uses the same display-block minimum geometry and a 140 ms arrival
animation. A `ResizeObserver` re-applies bottom anchoring when the transcript
height changes while follow mode is active.

The browser harness now records pending-math visibility, pending text length,
pending-slot height delta, and Layout Shift API values. The six focused cases
(`incomplete-math-block`, `incomplete-math-inline`, and
`stopped-incomplete-math`, each on Marked and Incremark) passed. Every open
window reported `pendingMathVisibleCount: 0`,
`pendingMathTextLength: 0`, and `pendingMathHeightDelta: 0`; every final report
reported `finalPendingNodeCount: 0`. The final focused repeat reported zero
Layout Shift entries for all six cases.

The final build evidence is:

- `npm run typecheck`: passed.
- `node --test test/streaming-markdown.test.js`: 7 passed.
- Normal `npm run build`: Vite completed, then the existing gate failed with
  the exact message `initial JS is 233518 B gzip; budget is 180000 B.`
- `CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build`: passed with initial JS
  `233518 B gzip`, initial CSS `27919 B gzip`, and largest lazy JS
  `185186 B gzip`.
- `npm test`: 273 passed, 0 failed.
- Managed restart: `bash .devcontainer/start-conduit.sh restart`. Health was
  `{"ok":true,"status":"ready","release":"development"}` and the
  listener was `0.0.0.0:4310`.
- Authenticated managed-server QA passed on Marked and Incremark. Each live
  formula ended with one `.katex`, zero pending nodes, and zero raw dollar
  delimiters. After unregistering the cached service worker, the final built
  CSS loaded as `index-CQ1hJ-_R.css`; both renderers kept the completed display
  block at a 33 px minimum height.

Verdict: the visible incomplete-math jump is removed. The remaining layout
change is normal transcript growth from newly arrived prose or code. This
change does not provide evidence for Incremark adoption.

### Manual validation checklist — Slice 6b presentation refinement

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310`, and test the same disposable chat with **Marked** and
**Incremark**.

- Stream a display equation over several seconds. Confirm no dashed box, no
  `Math in progress`, no raw `$` delimiters, and no partial equation appears.
- Stream an inline equation between two sentences. Confirm the sentence does
  not reflow vertically while the equation is incomplete.
- Complete the equation. Confirm it appears once, uses KaTeX, and fades in
  without a visible shrink or jump in the transcript.
- Stop generation inside `$$ ...` or `$ ...`. Confirm the incomplete formula
  remains invisible and no raw TeX or stale pending shell remains.
- Scroll away from the bottom before a formula completes. Confirm output does
  not force the viewport back to the bottom. At the bottom, confirm follow mode
  remains pinned while output grows.
- Reload the chat after completion. Confirm the stored formula has the same
  geometry and no arrival placeholder.
- Stream a fenced code block. Confirm the existing artifact preview and Copy
  control still work.
- Enable reduced motion. Confirm the formula remains visible and the layout
  stays stable even when the animation is suppressed.

Expected result: incomplete math is invisible, completed math appears once,
and the pending math slot does not change height during output.

Commit: `fix: keep incomplete math invisible during streaming`.

### Stable-tail stability pass — Incremark, first three steps

This pass combines the existing Incremark implementation with the stable-tail
ownership pattern used by the Marked path. It does not integrate
`@incremark/solid` and does not change Marked.

The adapter now uses keyed Solid store reconciliation for display blocks. The
native Incremark transformer still owns the completed-block queue and exposes
one active tail. Completed blocks stay in one keyed `<For>` list with the
active block; separating the active block into a second branch remounted it
when the block completed. Incomplete inline math is represented by an
invisible marker inside the active paragraph, heading, or table cell. The
marker is added only at render time, so it cannot enter the parser or the
typewriter queue. The root pending construct is suppressed for that inline
case.

This is the first three steps of the stability plan:

1. Preserve completed block identity with keyed reconciliation.
2. Keep one mutable active tail alongside immutable completed blocks.
3. Keep incomplete inline math in its original parent with an invisible
   placeholder.

The deterministic results are split by construct. The focused inline-math
fixture passed with `domMutations: 3966`, `layoutShiftCount: 1`, cumulative
layout shift `0.0000066408`, zero rendered-block height reversals, zero
rendered-block top reversals, zero Long Tasks, and exact final text equality.
The rich-Markdown regression passed with `domMutations: 45`, zero layout
shifts, zero reversals, and zero Long Tasks. The final Typewriter reports for
these runs reached source/display `2104/2104` and `47/47`, with zero backlog.

The table-and-math fixture still fails the geometry gate. It reported
`domMutations: 1092`, cumulative layout shift `0.0108008`, four layout-shift
entries, 26 rendered-block height reversals, 48 rendered-block top reversals,
and zero Long Tasks. This confirms that keyed reconciliation and parent-local
pending math reduce remount risk but do not freeze table geometry. Table
structure and column geometry remain the next implementation step.

Verification completed for this pass:

- `npm run typecheck`: passed.
- `npm test -- test/incremark-typewriter.test.js`: 293 passed, 0 failed.
- `node --test test/markdown-settings.test.js`: 3 passed, 0 failed.
- `npm run build`: passed; initial JavaScript `128662 B gzip`, initial CSS
  `19472 B gzip`, largest lazy JavaScript `185186 B gzip`.
- `npm run test:harness:browser -- --fixture inline-math-stream --renderer incremark --typewriter --require-typewriter-metrics`: passed.
- `npm run test:harness:browser -- --fixture rich-markdown --renderer incremark --typewriter --require-typewriter-metrics`: passed.
- The same command for `math-table-oscillation` remains red on the geometry
  assertions above; its final source/display count was `444/444`.
- `bash .devcontainer/start-conduit.sh restart`: passed. Health returned
  `{"ok":true,"status":"ready","release":"development"}`.
- Managed-server QA on chat
  `ced1f475-6e71-4d91-9056-75f3f24e29ef` passed. Incremark with Typewriter
  was selected, then Marked disabled the Typewriter control, and switching
  back left the completed transcript intact without replay. Re-enabling
  Typewriter reported zero display-busy nodes and zero pending nodes after
  seeding.

No default-renderer change is made. Marked remains available and unchanged.

### Manual validation checklist — stable-tail pass

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310`, and select Incremark with Typewriter enabled.

- Stream prose with inline `$…$` math. Confirm the open formula stays
  invisible inside the sentence and does not add a second pending row.
- Complete the formula. Confirm it appears once as KaTeX without a paragraph
  remount or visible transcript flash.
- Stream several paragraphs, headings, lists, and code. Confirm completed
  blocks do not flash or reset while the active tail changes.
- Stream a table containing inline math. Watch the bottom of the transcript
  and record any column-width changes, row-height reversals, or scroll jumps;
  this remains the known open issue for the next step.
- Switch to Marked and repeat the same content. Typewriter must be disabled,
  and Marked output must remain unchanged.
- Stop and reload after completion. Confirm no pending inline marker remains,
  no raw TeX is visible, and the final answer does not replay unexpectedly.

### Manual validation checklist — Slice 6b

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310`, authenticated disposable chat. Record pass/fail for
**Marked** and again for **Incremark**.

- Prompt for a multi-formula answer (classical mechanics / Maxwell / uncertainty).
  While tokens arrive, confirm open formulas never appear as raw `$$…` or
  `$…` source in the answer body. Completed formulas typeset.
- Confirm fenced code still opens as an artifact (header + body) before the
  closing fence arrives; Copy still works when complete.
- Stop generation in the middle of a formula. Pending chrome clears; no stuck
  raw delimiters; no duplicate answer row.
- After completion, refresh. Final message still typesets closed math; no
  pending chrome on the historical row (`streaming` false).
- External link confirmation and absence of unsafe HTML still hold.
- Switch renderer and repeat the math prompt. Default after fresh session
  remains Marked.

Expected result: both renderers meet the product contract above; only the
pending tail differs from today's raw-text leak; finalized transcripts match
baseline semantics.

### Slice 7 — #24 decision gate and focused tests

Choose one outcome: reject Incremark, augment the current renderer for a
bounded live-only case, or propose adoption. Update #24 with the evidence and
request owner approval before any production renderer change.

Slice 7 **consumes Slice 6b**. Incomplete-construct streaming behavior is no
longer an open unknown for either path; the decision must cite mid-stream
fixture evidence, not final-only KaTeX checks. If Slice 6b lands shared
presentation that makes Marked "good enough" on the visible cadence that
motivated Incremark, say so explicitly—that is a valid reject-or-augment
input, not a silent scope cut.

Worker boundary: evidence synthesis, focused tests that preserve a decision,
and the issue update only. Do not implement a renderer outcome in this slice.

Acceptance:

- The decision names compatibility, security, identity, visible cadence,
  persistence, bundle evidence, and **mid-stream incomplete math/fence**
  behavior on both paths after Slice 6b.
- Rejected capabilities and remaining gaps are explicit.
- Focused tests cover every behavior that influenced the decision.
- No renderer replacement occurs without owner approval.

Verification: review the report and issue update; rerun the focused fixture
set including `incomplete-math-block` and `incomplete-math-inline`; run the
full repository checks for any committed test changes.

Commit: `docs: record issue 24 renderer decision`.

### Slice 8 — Renderer implementation, only if approved (#24)

Implement only the approved outcome in a separate change. Keep the current
renderer as the compatibility fallback until all gates pass. This slice is
not authorized by the investigation plan alone.

Worker boundary: only the outcome and file scope approved after Slice 7. Start
from the approved commit, repeat the approved gates, and stop after the
implementation handoff. Do not remove the Marked fallback until a separate
owner decision approves that removal.

Acceptance and verification must use the approved Slice 7 gates, plus the
production build, security tests, persistence tests, release canaries, bundle
budget review, and agent-browser manual review.

### Slice 9 — Desktop panel motion under heavy KaTeX / long transcripts

Explore and pick a fix for choppy left-sidebar and right-workspace-panel open
or close animation when the active chat transcript is KaTeX-dense. This is
**shell layout**, not Markdown renderer work. It is orthogonal to #24 adoption.
Do not fold it into Slice 7 or Slice 8.

#### Measured finding (pre-slice, diagnosis only)

Reproduced on managed `4310` with chat
`207db426-97c1-44bf-b1fc-3cbd2172a608` (Pi session
`019fc7fd-0538-79b4-acef-ea3059afc95d`): desktop sidebar and workspace panel
open or close is choppy. A new empty chat and a long plain-text chat on the
same build stay smooth.

Source density for that session (assistant text): ~40k characters, **74**
block `$$…$$`, **116** inline `$…$`, ~897 TeX commands — rough KaTeX DOM on
the order of **10k–15k** nodes from math alone. A larger local session
(~52KB jsonl) with **zero** `$$` did not show the same hitch, so length alone
is a weak predictor; **typeset math node count × width-driven reflow** is the
strong one.

Mechanism in current CSS (`conduit-web/src/client/styles.css`):

- Desktop `.conduit-sidebar` uses `transition: width` (`244px` ↔ `52px`).
- Desktop `.workspace-panel` uses `transition: width` / `margin-right`
  (`0` ↔ `--workspace-panel-width`).
- `.chat-main` is `flex: 1` in the same row, so every animation frame changes
  the conversation column width.
- `Transcript` mounts the full timeline (`For` over rows); there is no message
  virtualization. `.chat-markdown` uses `overflow-wrap: anywhere`.
- Mobile already uses `transform: translateX(...)` for both panels — the
  compositor-friendly path desktop lacks.

Causal chain: width tween → flex reflows `.chat-main` every frame → layout
walks the full mounted transcript including deep KaTeX trees → main thread
misses frames over `--panel-motion-duration` (160ms). The sidebar edge is what
the eye tracks; the bill is mostly transcript layout.

Product pattern (ChatGPT / Linear / Notion class UIs): keep panel motion on
`transform` / `opacity`, or push layout with an **empty spacer** while the
panel chrome is fixed/absolute; and/or bound live transcript DOM
(virtualization, `content-visibility`). They do not width-animate a flex
neighbor of an unvirtualized math-heavy document.

#### Goal of this slice

1. Quantify the hitch with a repeatable probe (not subjective smoothness alone).
2. Spike 2–3 candidates behind a local-only flag or temporary CSS branch.
3. **Pick one** primary approach with evidence; record rejects.
4. If the winner is small and shell-only, implement it in this slice. If it
   requires transcript virtualization or a broad layout rewrite, stop at the
   decision and open a follow-up implementation slice — do not expand scope
   silently.

#### Candidate set (evaluate in this order)

| ID | Approach | Intent |
| --- | --- | --- |
| A | **Transform / overlay desktop panels** (align with mobile): panel slides with `translateX`; transcript width stable during the gesture; final open state may reserve space with a one-shot layout or remain overlay until idle | Kill per-frame main-column reflow |
| B | **Notion/Linear hybrid:** empty flow **spacer** animates width; panel surface is `position: absolute` or `fixed` at full panel width and moves with `translateX` so panel *content* does not reflow; decide whether main content width updates every frame, at end only, or via spacer only | Keep push layout without width-tweening heavy chrome |
| C | **Snap layout + short opacity/transform chrome:** commit end width in one frame; animate only shadow/opacity/edge | Cheapest; may feel less fluid |
| D | **`content-visibility: auto`** (and stable intrinsic size) on offscreen message rows | Reduce layout of offscreen KaTeX without changing panel CSS |
| E | **Transcript virtualization** | Structural bound on DOM; largest win for huge threads; highest risk to scroll/follow/stream contracts |

Default preference if measurements are close: **A or B for the panel**, with
**D as a cheap additive** if it helps scroll and secondary resizes. Treat **E**
as a separate project unless A–D cannot meet the frame budget on the math
fixture — virtualization touches follow-scroll, load-older anchoring, streaming
tail, and tool/trace rows.

#### Measurement contract

Use the math-heavy chat above (or a deterministic fixture that injects the same
assistant Markdown into a disposable session) and a long plain-text control of
similar character count.

For left sidebar toggle and right workspace-panel toggle, record per candidate:

- Animation duration and whether main column width changes per frame
- Frame gaps / Long Tasks during the 160ms window (Performance panel or
  harness `requestAnimationFrame` probe)
- Layout/reflow time attributable to the transcript subtree if observable
- DOM counts: total nodes, `.katex` count, message-row count
- Final layout correctness: no clipped composer, no persistent gap, panel hit
  targets, focus, `localStorage` open state preserved
- Scroll: follow mode and scroll-away distance unchanged after the gesture
  settles
- Mobile path unchanged (already transform-based)

Do not use subjective smoothness as the only gate. One noisy run is
insufficient; repeat the math fixture at least three times per candidate.

#### Worker boundary

In scope:

- Diagnosis record (this section)
- Local spike CSS/DOM structure for desktop sidebar and workspace panel
- Optional `content-visibility` experiment on message shells
- Measurement harness or agent-browser Performance probes
- Decision writeup in this file
- Implementation **only** if the chosen fix is shell-scoped (A/B/C and
  optionally D) and passes acceptance

Out of scope:

- #24 renderer choice, Incremark adoption, Slice 6b incomplete-math semantics
- Protocol, active-generation, timeline projection
- Full transcript virtualization unless A–D fail and owner approves expanding
  into a follow-up slice
- Changing mobile panel behavior except to share primitives safely
- Raising bundle budgets to hide cost

#### Acceptance

- Baseline hitch reproduced with numbers on the math chat; plain-text control
  remains under the same budget.
- At least two candidates measured; winner named with frame-gap / Long Task
  comparison against baseline.
- Winner keeps: desktop usable push or intentional overlay UX (document which),
  keyboard shortcuts (`toggle-sidebar`, workspace panel), stored panel open
  state, resize handle on workspace panel, no transcript scroll jump after
  settle, no composer or header clipping.
- Mobile behavior unchanged or strictly improved.
- If implemented: production default uses the winner; spike flags removed; typecheck
  and focused UI checks pass. If not implemented: follow-up slice title and
  scope are written here; no half-landed CSS.

#### Verification

- Agent-browser on managed `4310`: math chat + plain chat, left and right
  toggles, before/after or flag A/B.
- Performance evidence attached or summarized in this file (frame gaps, Long
  Tasks, katex node count).
- `npm run typecheck` if code changes; no protocol test churn expected.
- Manual: collapse/expand sidebar, open/close workspace panel, resize panel,
  reload with panel open, mobile width if convenient.

Commit (investigation only): `docs: record panel motion options under heavy KaTeX`.

Commit (if shell fix lands in-slice): `fix: keep transcript width stable during desktop panel motion`
(or the accurate one-line summary of the chosen approach).

### Manual validation checklist — Slice 9

Run `bash .devcontainer/start-conduit.sh restart`, open
`http://127.0.0.1:4310`. Use the math-heavy chat and a long plain-text chat.

- Toggle left sidebar open/closed several times on the math chat. Motion must
  meet the measured budget; no multi-frame hitch visible on a normal desktop.
- Toggle workspace panel open/closed the same way. Resize handle still works
  when open.
- Repeat on the plain-text chat (must stay smooth; no regression).
- After toggles, scroll position and follow mode behave as before; composer
  remains usable; no blank gap where the panel was.
- Reload with workspace panel previously open; state restores without a stuck
  width.
- Optional: narrow the window to the mobile breakpoint; drawer still uses
  transform and is not worse than today.

Expected result: a named winner with evidence; either shipped shell fix or an
explicit deferred virtualization/follow-up slice — not an open-ended spike.

## Measurable success criteria

### #34

- For an ordinary delta, reducer and projection counters show one addressed
  block update and no full timeline rebuild.
- Changed accessor count, reference churn, projection count, and affected-row
  count remain constant as accumulated block text, persisted row count, and
  unrelated active message/block/tool count grow independently.
- Duration distributions do not show growth attributable to unrelated history,
  blocks, or tools. Report string append and Markdown cost separately from
  state and projection.
- Unchanged row keys and outer/semantic DOM nodes retain identity.
- Frame-gap and Long Task distributions do not regress from the baseline.
- Final semantic content, checkpoint persistence, reconnect recovery, and
  scroll-follow behavior remain equal to baseline.

The exact numeric threshold will be set after Slice 1 records repeated runs on
the supported browser. Do not invent a threshold from one run. The required
shape is bounded per-delta work, not only a lower total time.

### #24

- Renderer measurements separate parse, KaTeX, sanitisation, and reconciliation
  work from state/projection work.
- Streaming output is immediate and fully styled, with no completion or block
  boundary churn.
- Outer response and semantic nodes retain identity through streaming and
  completion.
- Final semantic content and durable persistence match Marked baseline.
- Security behavior remains equivalent for HTML, images, URL protocols,
  external-link confirmation, and artifact controls.
- The candidate shows a measured renderer-work benefit and an agreed bundle
  impact before adoption.

## Risks and compatibility gates

- **Protocol:** preserve structured event names, IDs, sequence ordering,
  coalescing, resume, and slow-reader recovery.
- **Persistence:** keep Pi JSONL authoritative; preserve completion checkpoint
  and live-to-final reconciliation.
- **Solid ownership:** avoid broad signal reads and preserve stable durable
  timeline keys.
- **DOM identity:** retain outer response, semantic nodes, focus, copy
  controls, and row types through streaming and completion.
- **Scroll:** preserve follow mode, user scroll-away, anchor preservation, and
  post-Markdown layout settling.
- **Shell panel motion:** desktop sidebar and workspace panel must not
  width-animate against an unbounded KaTeX transcript without a measured
  budget; Slice 9 owns the fix choice. Mobile transform drawers stay the
  reference for compositor-friendly motion.
- **Security:** preserve DOMPurify restrictions, protocol checks, external-link
  confirmation, image removal, and artifact behavior. Incremark raw HTML is a
  hard review gate.
- **Markdown compatibility:** cover incomplete syntax (including open math and
  open fences mid-stream), GFM, KaTeX, fenced code, reference definitions,
  links, long tokens, thinking, and tools.
- **Bundle:** measure initial and lazy gzip output; do not accept a dependency
  increase without an explicit owner decision.
- **Accessibility and CSS:** preserve semantic elements, keyboard behavior,
  labels, focus, and existing class hooks.
- **Browser variance:** repeat critical measurements and report browser and
  runtime versions. Treat one noisy frame report as insufficient.

## Behaviors that must remain unchanged

Keep server event meaning and recovery behavior; Pi JSONL ownership; message,
block, tool, and timeline identity; immediate styled assistant output; literal
user messages; Marked security behavior until #24 is approved; KaTeX, tables,
lists, fenced code, artifacts, links, and external-link confirmation; thinking
and tool presentation; reconnect and checkpoint persistence; navigation and
scroll-follow semantics; copy controls; and authentication or server process
lifecycle.

## Do not attempt yet

- Do not work on #37.
- Do not start full transcript virtualization outside Slice 9's decision
  (candidate E only if A–D fail and owner expands scope).
- Do not replace the renderer.
- Do not add `@incremark/solid` to production dependencies.
- Keep the exact `@incremark/core` dependency and lockfile entries scoped to the
  local investigation adapter until the decision gate passes.
- Do not redesign the server protocol or Pi/provider path.
- Do not persist renderer state.
- Do not perform a broad UI rewrite.
- Do not run live provider-cost benchmarks.
- Do not change deployment or VPS behavior.
- Do not use Playwright for exploratory measurements.

## Review and handoff

The Slice 1 review passed on 3 August 2026:

1. Telemetry separates #34 reducer and projection work from #24 parse, KaTeX,
   sanitisation, and reconciliation work.
2. Rich-Markdown fixtures compare structure, semantic node counts, safe
   attributes, security behavior, and interactions. Normalized text remains a
   separate cadence signal.
3. The reports expose per-delta work counts and timing series needed to set the
   Slice 2 scaling sizes and thresholds.
4. Deterministic and authenticated checks preserve security, DOM identity,
   reconnect, copy, external-link confirmation, and scroll behavior.
5. The paired run produced the same structural result with instrumentation
   disabled.

The Slice 6 candidate gate was not promising on published
`@incremark/solid`; the local `@incremark/core` adapter remains for
comparison. Slice 4 boundary/recovery and Slice 5 Marked baseline are
recorded. #24 path remains 6a → 6b → 7 → optional 8. Slice 6b is authorized
dual-renderer presentation work; it is not adoption. Any default-renderer
change still requires owner approval after Slice 7.

**Slice 9** is queued for desktop panel motion under KaTeX-dense transcripts
(width-tween reflow vs transform/spacer candidates). It is shell layout, not
part of the renderer decision, and must not block Slice 7.

### Slice 6c — Progressive math preview rejected; invisible pending math retained

The progressive KaTeX preview experiment was rejected during manual testing.
It called KaTeX while the answer was still streaming and caused visible full-
transcript flashing. A live math-heavy chat also slowed the browser tab enough
to trigger the browser's “fix the tab” warning. The experiment was removed
before promotion; its preview helper, stage animation CSS, and preview-specific
harness checks are not part of the implementation.

The contract returns to the Slice 6b presentation refinement:

- stable prose, code, links, and other Markdown use the existing renderer path;
- an open math construct has no visible TeX and no partial KaTeX rendering;
- the pending math region remains invisible with fixed geometry while it is
  open, so the transcript does not grow on every math token;
- KaTeX renders once after the closing delimiter arrives, then uses the small
  arrival animation;
- no new math-specific parser, animation stage, or repeated preview work is
  added to either renderer.

This is a presentation and workload boundary, not Incremark performance
evidence. The shared delimiter classifier remains. The focused harness must
continue to assert zero visible pending math, zero pending text, stable pending
height, final KaTeX, and no regression in ordinary Markdown streaming.

Manual validation for this direction:

- Stream a long prose answer. Confirm ordinary text does not flash or pause.
- Stream an incomplete display equation. Confirm no partial equation, raw
  delimiter, label, or visible placeholder appears.
- Close the equation. Confirm one KaTeX block appears and uses the arrival
  animation.
- Repeat with inline math and with both Marked and Incremark selected.
- Pause a long math-heavy generation. Confirm the browser tab remains
  responsive and the transcript does not repeatedly repaint.
- Run `rich-markdown`, `scroll`, `incomplete-math-block`,
  `incomplete-math-inline`, and `stopped-incomplete-math` in the deterministic
  browser harness. Record results here, not in a separate file.

#### Slice 6c result — 4 August 2026

The progressive preview code was removed. The final working tree contains the
committed invisible-pending implementation plus this documentation note only.
The managed server was restarted with
`bash .devcontainer/start-conduit.sh restart`; health returned
`{"ok":true,"status":"ready","release":"development"}` and `ss` showed
`0.0.0.0:4310`.

The focused deterministic browser run used Chromium `149.0.7827.55`, Node
`v24.18.0`, steady 16 ms cadence, three-character deltas, and seed `1`:

| Fixture | Renderer | Completion ms | DOM mutations | Long tasks | Max layout shift | Pending visibility / text / height |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `incomplete-math-block` | Marked | 981.4 | 25 | 2 / 110 ms | 0.000195 | 0 / 0 / 0 px |
| `incomplete-math-block` | Incremark | 1050.3 | 45 | 3 / 71 ms | 0.000011 | 0 / 0 / 0 px |
| `incomplete-math-inline` | Marked | 714.6 | 29 | 1 / 97 ms | 0.000038 | 0 / 0 / 0 px |
| `incomplete-math-inline` | Incremark | 362.1 | 37 | 0 / 0 ms | 0 | 0 / 0 / 0 px |
| `stopped-incomplete-math` | Marked | 505.0 | 18 | 2 / 70 ms | 0 | 0 / 0 / 0 px |
| `stopped-incomplete-math` | Incremark | 708.6 | 21 | 2 / 69 ms | 0 | 0 / 0 / 0 px |

All six cases passed. The normal Incremark inline run missed the short open-
math snapshot window; one `CI=1` retry passed. This is a harness timing issue;
the final semantic result had KaTeX and no pending node.

The rich and scroll comparison in the same run passed on both renderers. Rich
Markdown used 45 DOM mutations on Marked and 88 on Incremark, with completion
times of 684.4 ms and 649.5 ms. The scroll fixture used 217 and 411 DOM
mutations, with completion times of 3779.2 ms and 3851.1 ms. Neither renderer
reported a Long Task. Marked and Incremark both ended the scroll fixture at
zero distance from the bottom. The Incremark rich fixture ended 36 px above
the bottom in this repeat and remains an existing follow-mode observation.

Verification completed:

- `npm run typecheck`: passed.
- `node --test test/streaming-markdown.test.js`: 7 passed.
- `npm test`: 273 passed, 0 failed.
- `npm run build`: Vite completed, then the existing bundle gate reported the
  exact failure `initial JS is 233518 B gzip; budget is 180000 B.`
- `CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build`: passed with initial JS
  `233518 B gzip`, initial CSS `27919 B gzip`, and largest lazy JS
  `185186 B gzip`.
- Managed agent-browser loaded the linked chat on Marked and Incremark. The
  final transcript had 205 KaTeX nodes, zero pending nodes, and zero raw dollar
  delimiters inside each Markdown root. No page errors appeared.

Verdict: the visible progressive-preview experiment is rejected. Keep
incomplete math invisible and render KaTeX once at completion. Do not change
ordinary Markdown streaming to make math look smoother.

### Slice 6d — Stable transcript tail and invisible pending KaTeX

The live test exposed a separate regression: the renderer rebuilt the full
stable transcript on every delta. In a long math answer, this repeatedly
called KaTeX and reconciled every prior equation. The browser then flashed the
transcript and could show the browser slow-tab warning.

The implementation now keeps two boundaries in the block Markdown root:

- completed top-level tokens stay in place and keep their DOM nodes;
- only the current top-level Markdown tail is parsed, sanitised, and replaced;
- open math still renders no TeX and uses the existing invisible fixed-height
  pending region;
- completed KaTeX HTML uses a bounded 512-entry Marked cache, so a formula is
  rendered once even while its tail receives later whitespace or prose;
- Incremark keeps completed `ParsedBlock.id` nodes and caches each AST math
  node's KaTeX HTML;
- inline Markdown keeps the existing full inline path. This slice changes the
  block stream path only.

This preserves the ordinary visible Markdown contract. It removes repeated
work from completed math and stable transcript nodes. It does not add a
progressive math preview.

#### Slice 6d benchmark — 4 August 2026

The deterministic stress fixture is `math-stress`: 96 display equations,
9,017 source characters, 282 deltas, 32-character chunks, zero interval, and
seed `1`. The browser was Chromium `149.0.7827.55` on Node `v24.18.0`.

| Renderer | Baseline completion | Result completion | Baseline DOM mutations | Result DOM mutations | Baseline actual KaTeX renders | Result actual KaTeX renders | Baseline long tasks | Result long tasks | Result max task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Marked | 22,197.8 ms | 6,079.5 ms | 10,373 | 839 | 13,673 | 96 | 161 / 415 ms max | 2 / 139 ms max | 139 ms |
| Incremark adapter | not recorded before this slice | 5,611.2 ms | not recorded before this slice | 411 | not recorded before this slice | 103 | not recorded before this slice | 1 / 68 ms max | 68 ms |

The Marked result is a measured improvement: completion is 72.6% lower,
DOM mutations are 91.9% lower, and actual KaTeX renders are 99.3% lower.
Both renderers passed the `maxKaTeXCalls: 120` and `maxLongestTaskMs: 250`
stress gates. The Incremark result is a current measurement, not a before and
after claim; its pre-slice stress baseline was not recorded.

The focused browser matrix passed for both renderers: `rich-markdown`,
`security`, `katex`, `incomplete-math-block`, `incomplete-math-inline`,
`stopped-incomplete-math`, `incomplete-fence`, `code-copy`,
`external-confirmation`, and `scroll`. The first Marked stopped-math run found
the final-state marker bug; the fixed case passed on rerun.

Bundle result: the normal `npm run build` completed Vite and failed the
existing budget at `initial JS is 234365 B gzip; budget is 180000 B`. The
diagnostic `CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build` passed with
initial JS `234365 B gzip`, initial CSS `27919 B gzip`, and largest lazy JS
`185187 B gzip`. The initial JS increase from the prior `233518 B gzip` result
is `847 B gzip`.

The managed server was restarted with
`bash .devcontainer/start-conduit.sh restart`. It reported ready on port 4310
with PID `99982`; `ss` showed `0.0.0.0:4310`. The unauthenticated browser check
redirected the exact chat URL to `/login`, as expected for a new browser
session. The allow-listed manifest returned successfully. The deterministic
browser harness supplied the renderer evidence.

Manual validation checklist:

- Open the exact chat URL with `?markdownRenderer=marked`, then repeat with
  `?markdownRenderer=incremark`.
- Send `Output a lot of math` or replay a long math answer. Confirm that prior
  prose and equations do not flash when new text arrives.
- While `$$ ... $$` is open, confirm that no raw delimiter, partial TeX, or
  partial KaTeX appears. Confirm that the reserved region does not change
  height.
- When the closing delimiter arrives, confirm that one complete equation
  appears. Confirm that the small arrival animation does not move the full
  transcript.
- Pause generation during an equation. Confirm that the tab stays responsive
  and the visible transcript remains unchanged.
- Repeat with inline math, an open fenced code block, copy controls, an
  external link, and scroll-away from the bottom. Confirm that ordinary
  Markdown, security behavior, and follow mode remain unchanged.

Current conclusion: keep both renderers available. The stable-tail work
removes the measured full-transcript math regression. It does not select a
default renderer or advance the Slice 7 adoption gate.

### Slice 6e — Instant completed-math reveal and ordinary-path guard — 4 August 2026

Manual review changed the presentation direction again. Keep the completed
KaTeX reveal, but make it appear immediately after its final render. Remove the
fade/transform arrival animation. The open construct remains invisible with
fixed geometry. This avoids showing a semi-rendered equation and removes a
separate paint effect from the math path.

The implementation also keeps the existing Marked path for ordinary block
messages. The stable-tail path activates only when the source contains a
parsed math token or an open math construct. Inline Markdown continues to use
the existing full parse/reconcile path. Removed dead code includes the
`animateMath` plumbing, the Incremark new-math `WeakSet`, and the
`streaming-final-math` CSS rule and keyframe.

The Incremark persisted/stopped path received one correctness fix in this
round. A non-prefix source now resets and appends through the parser, merges
all parser updates, and does not finalize while the shared splitter still
reports an open construct. This preserves completed blocks instead of showing
only an invisible pending shell after reload.

#### Slice 6e measurements

The deterministic stress fixture is `math-stress`: 96 display equations,
9,017 source characters, 282 deltas, 32-character chunks, zero interval, and
seed `1`. The browser was Chromium `149.0.7827.55` on Node `v24.18.0`.

| Renderer | Completion ms | DOM mutations | Actual KaTeX renders | Long tasks | Max task | Math-root mutation target |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Marked | 6,108.0 | 749 | 96 | 2 | 142 ms | `.chat-markdown`: 711 child-list records |
| Incremark adapter | 5,942.2 | 403 | 103 | 1 | 51 ms | `.incremark`: 385 child-list records |

Against the recorded Marked full-reconcile baseline of 22,197.8 ms,
10,373 DOM mutations, 13,673 actual KaTeX renders, and 161 long tasks, the
current Marked stress result is 72.5% faster to completion, has 92.8% fewer DOM
mutations, 99.3% fewer KaTeX renders, and 98.8% fewer long tasks. The remaining
child-list records target the renderer root while the current tail grows; the
transcript container is not being replaced. This is evidence of reduced work,
not a claim that every tail mutation is gone.

The final 20-case browser matrix passed for both renderers: `rich-markdown`,
`security`, `katex`, `incomplete-math-block`, `incomplete-math-inline`,
`stopped-incomplete-math`, `incomplete-fence`, `code-copy`,
`external-confirmation`, and `scroll`. The final scroll runs were 3,619 ms /
218 mutations for Marked and 3,594 ms / 419 mutations for Incremark, with zero
long tasks in both cases.

The rebuilt managed server was restarted with
`bash .devcontainer/start-conduit.sh restart`. Health returned
`{"ok":true,"status":"ready","release":"development"}` and `ss` showed
`0.0.0.0:4310`. Authenticated browser checks on the linked chat found 52 and
153 KaTeX blocks in both renderer modes, zero pending nodes, zero raw dollar
delimiters, zero page errors, and zero `streaming-final-math` elements.

Build verification: `npm run typecheck` passed; `npm test` passed with 273
tests; `git diff --check` passed. The normal build completed Vite and failed
the existing bundle gate at the exact value `initial JS is 234477 B gzip;
budget is 180000 B.` The diagnostic
`CONDUIT_BUDGET_INITIAL_JS_GZIP=300000 npm run build` passed with initial JS
`234477 B gzip`, initial CSS `27864 B gzip`, and largest lazy JS
`185186 B gzip`.

Manual validation checklist for this round:

- Open the linked chat with `?markdownRenderer=marked`, then repeat with
  `?markdownRenderer=incremark`.
- Send or replay `Output a lot of math`. Confirm that completed equations
  appear at once after their closing delimiter. Confirm there is no fade,
  slide, partial KaTeX, or raw delimiter.
- Pause while an equation is open. Confirm the equation stays invisible, the
  reserved region keeps its height, prior transcript content does not flash,
  and the tab stays responsive.
- Confirm ordinary prose, headings, code blocks, links, copy controls, and
  follow-mode scrolling behave as before.
- Repeat the exact checks after switching the renderer query parameter. Look
  for missing completed equations, duplicated equations, raw `$` or `$$`,
  pending placeholders that remain after completion, and any full-transcript
  jump.

Current conclusion: the requested presentation is now instant completed-math
reveal with invisible pending math and no math arrival animation. The measured
Marked improvement remains real. The remaining root-tail mutations and the
142 ms worst Marked stress task are recorded for the next performance round;
they do not justify switching the default renderer yet.

### Slice 6f — Prevent source-boundary resets and preserve completed math nodes — 4 August 2026

The stress trace found the remaining flash source. When the second `$` of a
new `$$` opener arrived, the streaming splitter shortened the visible stable
source by one character. The old Marked path treated that normal transition as
a non-prefix source and reset the complete renderer root. Three resets removed
131 already-rendered KaTeX nodes in batches of 15, 32, and 84.

Marked now trims and reconciles only the mutable tail when the source becomes
an open math construct. It records `append-pending-trim` instead of
`full-reset-source`. Completed nodes stay before the stable boundary.

The Incremark path had a smaller equivalent issue. Solid list ownership was
based on `ParsedBlock` object identity, even though the parser contract gives
each block a stable `id`. Math messages now use stable block IDs and one
math-specific completed/pending list. Ordinary Incremark messages retain the
previous block/pending presentation path so list and table semantics stay
unchanged.

The stress fixture now gates both regressions with
`maxRemovedMathNodes: 0` and `maxIncrementalResets: 0`.

#### Slice 6f measurements

The same `math-stress` fixture was run with Chromium `149.0.7827.55`, Node
`v24.18.0`, 96 display equations, 9,017 source characters, 282 deltas,
32-character chunks, zero interval, and seed `1`.

| Renderer | Completion ms | DOM mutations | Actual KaTeX renders | Long tasks | Root records | Added nodes | Removed nodes | Removed math nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Marked | 6,089.9 | 743 | 96 | 0 / 0 ms | 702 | 595 | 201 | 0 |
| Incremark adapter | 6,400.7 | 390 | 96 | 1 / 55 ms | 301 | 247 | 54 | 0 |

The current Marked run is 72.6% faster than the recorded 22,197.8 ms
full-reconcile baseline, with 92.8% fewer DOM mutations and 99.3% fewer
actual KaTeX renders. The prior Marked reset trace removed 131 math nodes;
the current trace removed zero. The outer renderer root remained stable. The
remaining 702/301 root records are current-tail operations, not completed
KaTeX removal.

The same final runs reported 3 and 4 frame gaps over 50 ms for Marked and
Incremark, zero gaps over 100 ms, and maximum layout-shift entries of
`0.00336` and `0.00224`. The Incremark run's 55 ms longest task remains well
below the 250 ms stress gate.

The one-frame render scheduler was measured and rejected. It reduced one
Marked run from 747 to 739 mutation records but increased completion from
about 6.1 s to 6.95 s and increased frame gaps. No scheduler code remains.

The final 20-case matrix passed for both renderers. `npm test` passed all 273
tests. `npm run typecheck` and `git diff --check` passed. The normal build
completed Vite and failed the existing gate at
`initial JS is 234757 B gzip; budget is 180000 B.` The diagnostic build passed
with initial JS `234757 B gzip`, initial CSS `27864 B gzip`, and largest lazy
JS `185188 B gzip`.

The managed server was restarted with
`bash .devcontainer/start-conduit.sh restart`; health returned
`{"ok":true,"status":"ready","release":"development"}` and the listener
was `0.0.0.0:4310`. Restored agent-browser QA on the linked chat passed in both
renderer modes: math counts `[0, 52, 0, 153]`, zero pending nodes, zero raw
dollar delimiters, zero animation nodes, and zero page errors.

Manual validation checklist for this round:

- Run `Output a lot of math` in Marked, then Incremark.
- Pause during an open `$$` construct. Confirm the open equation is invisible,
  prior equations do not flash, and the browser remains responsive.
- Watch the first character after a new `$$` opener. Confirm the old
  transcript remains in place and only the completed equation appears later.
- Confirm the final equation appears once, with no duplicate, raw delimiter,
  fade, slide, or pending node.
- Check ordinary prose, lists, tables, headings, code copy, links, and scroll
  follow mode. These must keep their prior behavior.

Current conclusion: the known full-root reset and completed-KaTeX removal paths
are fixed and enforced by the stress gates. Both maintained renderers now have
quantitative evidence for stable completed math under the reference workload.

### Adaptive Incremark Typewriter Mode — working-tree implementation, 5 August 2026

This spike adds an opt-in typewriter path for Incremark. Marked remains
unchanged and remains the default. The local control is available only when
Incremark is selected. It uses URL `markdownTypewriter=1|0` and local storage
key `conduit:incremark-typewriter`.

`conduit-web/src/client/chat/incremark-typewriter.ts` wraps the native
`@incremark/core` `BlockTransformer`. The native transformer owns
`requestAnimationFrame`, block queues, AST slices, cached display nodes,
`setOptions()`, and hidden-tab pausing. The Conduit controller only measures
visible AST characters, applies EMA alpha `0.25`, and calculates:

```text
leadRate = observedRate / 0.90
catchUpRate = backlogCharacters / 0.250s
targetRate = max(leadRate, catchUpRate)
```

There is no permanent visible-character ceiling. `controlRate` adds the
provider rate while a backlog drains. Source updates may pre-ramp the native
step before the next display frame; measured display work then limits or
relaxes that step. The controller uses a safe-step mode and can complete only
the active native block when sustained frame work exceeds the budget. No
safe-block fallback was triggered in the measured runs below.
Backlog age means provider-time distance (`backlog / observedRate`), not time
since the backlog first appeared. This avoids catch-up credit after a stall.

`conduit-web/src/client/chat/incremark-markdown.tsx` keeps incomplete math on
the existing invisible pending path, treats completed math as an atomic
transformer node, renders stable display blocks by block ID and structural
shape, and retains the existing immediate path when Typewriter is off. In
Typewriter mode, each completed math node is rendered as one complete KaTeX
string on a later animation frame. The math shell stays empty while that work
is pending, and the display-busy state remains true until the queued math work
finishes. This prevents raw TeX and partial KaTeX from appearing.
`conduit-web/src/client/chat/transcript.tsx` adds the Incremark-only checkbox
and busy-state data attribute. `conduit-web/src/client/turn-rows.ts` gives
live and persisted answers the same display key from user-turn ownership and
answer order. This preserves the Solid row and display session across
checkpoint replacement, reconnect projection, and queued follow-ups.
`conduit-web/src/client/state/active-chat.ts` coalesces adjacent same-block
text deltas up to a 256-character batch and flushes them before structural
events. Only an oversized same-block burst enters the bounded animation-frame
queue; normal deltas keep the existing immediate path. This reduces
post-stall source bursts without changing the wire protocol or imposing a
visible-character rate cap.
`conduit-web/src/client/chat/markdown-settings.ts` keeps renderer selection
outside the lazy renderer module, so the Marked and Incremark implementations
remain split from the initial bundle.

#### Refresh-rate-aware Typewriter cadence

The first Typewriter implementation used a fixed `16 ms` native transformer
interval. That was a startup default, but it also imposed a 60 Hz assumption:
the native transformer still schedules with `requestAnimationFrame`, yet it
could only advance when elapsed time reached 16 ms. A 144 Hz display can
provide callbacks about every `6.94 ms`, so the fixed interval would combine
multiple display frames into larger visible increments.

The controller now passively measures successive `requestAnimationFrame`
timestamps only while Typewriter is enabled. It applies an EMA with alpha
`0.25`, passes the measured interval into native `setOptions()`, and keeps the
frame-work budget as the safety control. A work EMA above `8 ms` relaxes the
tick interval to reduce pressure; it does not impose a visible-character cap.
The probe is stopped when Typewriter is disabled. Marked and immediate
Incremark do not run it.

The focused test models a 144 Hz interval of `6.944 ms` and verifies that the
tick interval follows it. The deterministic Chromium smoke run after this
change measured a frame interval and Typewriter tick interval of p50
`16.748 ms`, p95 `19.363 ms`, and max `20.250 ms` on its headless 60 Hz
profile. It produced visible increments of p50 `6`, p95 `8`, and max `8`
characters, with zero Long Tasks and zero layout shifts. This run used 115
ordinary-text characters, so it is cadence evidence rather than a replacement
for the 1,200-character profiles below.

#### Inline-math stability correction — 5 August 2026

The long inline-math fixture reproduced the remaining visible regression. The
Typewriter path deferred inline KaTeX into a later animation frame. As the
parent paragraph changed, the adapter could clear and queue the same inline
math span again. That changed line width and height after the ordinary text
painted, which caused transcript jumping and repeated math DOM work.

Completed inline math now renders synchronously with its atomic Typewriter
display update. Only display equations remain on the bounded one-equation
animation queue. A bounded 512-entry cache is keyed by math mode and source,
so new AST object identities do not cause the same inline formula to render
again. Incomplete math still uses the existing invisible pending path.

The new `inline-math-stream` fixture contains 2,591 source characters and 36
inline equations. Before the fix it measured 219 KaTeX calls, 49,942 DOM
mutations, 58 Layout Shift entries, and a `0.0299` cumulative Layout Shift
value. After the fix it measured 79 KaTeX calls, 50,466 DOM mutations, zero
Layout Shift entries, zero removed math nodes, and a `0.1965 s` display
completion delay. The DOM mutation count remains high because this is a
2,591-character, 864-delta stream; the visible layout regression is removed.
The fixture now gates cumulative Layout Shift below `0.001` and at most 96
KaTeX calls. This ignores one browser rounding-level shift while still failing
visible reflow.

Following owner approval, the default for users without an existing local
preference is now Incremark with Typewriter enabled. An explicit `marked`
renderer preference, `markdownRenderer=marked`, `markdownTypewriter=0`, or a
stored Typewriter-off preference still wins. Marked remains available through
the local renderer switch and URL override.

#### Pending-block reconciliation and standard TeX delimiters — 5 August 2026

The remaining remount cause was not the KaTeX cache. While an inline delimiter
was open, `IncremarkMarkdown` removed the entire pending paragraph from the
native `BlockTransformer` queue. The next update re-added that paragraph when
the delimiter closed. This removed and recreated the surrounding DOM even when
the completed formula itself was unchanged.

The adapter now parses the stable prefix before the open delimiter as a block
with the original block ID and keeps it in the queue. The pending formula stays
in the existing invisible presentation node. Stable `Index` reconciliation is
used for inline children, lists, table rows, and table cells. Completed inline
KaTeX mounts synchronously; display equations remain on the bounded deferred
queue. Both renderers now support `$...$`, `$$...$$`, `\\(...\\)`, and
`\\[...\\]`.

The deterministic checks used Chromium `149.0.7827.55` and Node `v24.18.0`.
Reports were written under `/tmp` and contain no transcript bodies.

| Run | Outcome | DOM mutations | Layout shift | Root records / added / removed | Removed math roots | KaTeX calls | Long tasks |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard delimiters, Incremark Typewriter, 196 chars | passed | 333 | 0 | 13 / 8 / 5 | 0 | 7 | 0 |
| Standard delimiters, Marked, 196 chars | passed | 78 | 0 | 16 / 14 / 6 | 0 | 5 | 0 |
| Long inline stream, Incremark Typewriter, 2,591 chars | passed | 50,405 | 0.0000066 | 109 / 73 / 36 | 0 | 87 | 0 |
| Exact stored response, Incremark Typewriter, 1,361 source chars | strict gate failed | 8,289 | 8 entries / 0.00436 | 81 / 47 / 34 | 0 | 45 | 0 |
| Exact stored response, Incremark immediate, 1,361 source chars | strict gate failed | 8,173 | 10 entries / 0.00508 | 83 / 48 / 35 | 0 | 47 | 0 |
| Exact stored response, Marked, 1,361 source chars | strict gate failed | 525 | 10 entries / 0.00550 | 65 / 55 / 23 | 3 | 33 | 0 |

The table above records the pre-table-CSS comparison. The final correction and
its replacement measurements are recorded in the next section.

The exact-response comparison shows the change removed the former math-root
remounts and reduced Layout Shift entries from 13 to 8 for Typewriter. The
remaining `0.00436` cumulative shift is ordinary transcript reflow from the
large mixed Markdown response, so it remains open against a zero-shift target.
Marked still has fewer total DOM mutations, but it remounts completed math
roots in this stream. The standard delimiter and long-stream fixtures pass;
the exact-response run is evidence, not a green acceptance result.

The incomplete inline fixture passed with one-character deltas so the open
delimiter was observed before its close: no raw delimiter, no pending text,
stable pending layout, one final KaTeX node, and zero removed math roots. The
incomplete display-math fixture passed the same checks.

Manual QA on the managed server passed the stored mixed-math chat route. The
server returned `{"ok":true,"status":"ready","release":"development"}`
and listened on `0.0.0.0:4310`. Incremark Typewriter showed 13 assistant KaTeX
nodes, zero pending nodes, and zero raw TeX delimiters. Switching to Marked
disabled Typewriter and preserved zero raw delimiters; switching back to
Incremark left Typewriter off until re-enabled. URL overrides
`markdownTypewriter=0` and `markdownTypewriter=1` produced the expected states.
No browser console or page errors were reported. The screenshot is retained at
`/tmp/issue24-chat-typewriter.png`.

#### Final table reflow correction — 5 August 2026

Layout-shift source geometry showed that the remaining math-related movement
came from streamed tables, not from KaTeX remounts. Automatic table layout
changed column widths as each inline formula arrived. Default table-cell
centering then moved an inline formula vertically when a row gained a line.

Incremark streamed tables now use fixed layout and top-aligned cells. These
rules are scoped to Incremark; Marked keeps its previous table CSS. The
diagnostic harness records the source element and ancestor chain for each
Layout Shift, so a future regression can distinguish math, table, action-row,
and full-root movement.

| Probe | Outcome | Source chars | DOM mutations | Layout shift entries / CLS | Root records / added / removed | Removed math roots | KaTeX calls | Long tasks | Display delay |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Exact stored response, Incremark Typewriter | passed | 1,361 | 8,400 | 1 / 0.000719 | 81 / 47 / 34 | 0 | 48 | 0 | 139.8 ms |
| Mixed inline-math table, Incremark Typewriter | passed | 2,546 | 5,155 | 0 / 0 | 102 / 52 / 50 | 0 | 36 | 0 | 124.0 ms |
| Incomplete inline math, one-character deltas | passed | 54 | 88 | 1 / 0.000010 | — | 0 | 1 | 0 | 74.8 ms |
| Incomplete display math, one-character deltas | passed | 71 | 77 | 1 / 0.000011 | — | 0 | 1 | 0 | 62.6 ms |

The exact response now has one small Layout Shift from the shared
`response-actions` row moving with ordinary message growth. Its sources do not
include `.chat-markdown`, a table, or a KaTeX node. The outer Markdown root
remained persistent, and no completed math root was removed. The mixed table
probe has zero Layout Shift entries and a steady-state relative lag p95 of
`0.36%` with backlog-age p95 of `18.5 ms`.

The current adaptive stress checks also pass. A high-throughput table stream
completed provider delivery in `9.3 ms`, drained in `2,685.7 ms`, reached a
maximum `220`-character frame step, and produced zero Long Tasks or Layout
Shifts. The stalled inline stream recorded a `300 ms` source stall, a maximum
backlog of `1,875` characters, a maximum `648`-character frame step, a
`1,315 ms` display drain, zero Long Tasks, and zero Layout Shifts. Neither
profile produced an instant reveal.

Manual QA after the final managed-server restart passed the reported mixed-math
route. Incremark Typewriter showed 13 assistant KaTeX nodes, zero pending
nodes, and zero raw TeX delimiters. Marked disabled Typewriter and showed zero
raw delimiters. Switching back to Incremark left Typewriter off until enabled;
enabling it did not replay the existing transcript. The server health response
was `{"ok":true,"status":"ready","release":"development"}` and the
listener was `0.0.0.0:4310`. No browser console or page errors were reported.

#### Nested inline-math atomicity and pane-width tables — 5 August 2026

The reference chat `ced1f475-6e71-4d91-9056-75f3f24e29ef` exposed one remaining
Incremark regression. Inline formulas inside paragraphs and table cells were
still sliced one source character at a time. The published core math plugin
matches only when the math node is the current block root; it does not apply
recursively while the generic paragraph or table-cell slicer walks child
nodes. The result was temporary partial KaTeX, empty math spans, and vertical
oscillation.

The Typewriter adapter now prepares nested `math` and `inlineMath` nodes as
atomic leaves before passing blocks to the native transformer. It keeps the
formula source in a private adapter field instead of `value`, so the native
AST slicer keeps the whole node while the adapter still renders the original
formula. This keeps the native queue, frame scheduler, and cached slices in
use. Marked is unchanged.

Incremark tables now keep fixed layout after completion and use stable column
hints. On wide chat panes, a table can use up to 150% of the assistant
transcript width, capped and centred at the chat-pane width. This gives tables
room for formulas without widening ordinary prose. The rule is scoped to
Incremark; narrow panes keep the normal table width.

The browser harness now records final table geometry, table-layout transitions,
and changes to completed inline-math geometry. The new
`math-table-oscillation` fixture contains inline formulas before, inside, and
after a five-column table.

| Probe | Before atomic nested math | After atomic nested math |
| --- | ---: | ---: |
| Source characters | 1,088 | 1,088 |
| DOM mutations | 9,851 | 10,905 |
| Inline-math geometry transitions | 34 | 4 |
| KaTeX calls | 58 | 26 |
| Removed math roots | 0 | 0 |
| Layout Shift entries / CLS | 0 / 0 | 1 / 0.000010 |
| Long tasks | 0 | 0 |

The small increase in DOM mutations on this fixture comes from inserting
complete math nodes instead of their partial text slices. The long
`inline-math-stream` fixture measured 2,591 source characters, 46,110 DOM
mutations, 1 inline-math geometry transition, 36 KaTeX calls, zero removed
math roots, CLS `0.0000066`, and zero Long Tasks after the change. The
oscillation-specific geometry work therefore fell by 88%, and KaTeX calls fell
by 55% on the 1,088-character reproduction.

The screenshot-shaped four-column fixture passed with a 960 px table in a
1,024 px chat pane. Its columns measured 134 / 345 / 192 / 288 px, the table
stayed `table-layout: fixed` through completion, and it recorded 1 tiny KaTeX
rounding shift with CLS `0.0000158`. The existing 2,546-character mixed table
fixture used the same 960 px geometry, recorded zero Layout Shift entries, and
kept the final table layout fixed. Both fixtures recorded zero Long Tasks and
zero removed math roots.

The managed server was rebuilt and restarted with
`bash .devcontainer/start-conduit.sh restart`. Health returned
`{"ok":true,"status":"ready","release":"development"}` and the listener
was `0.0.0.0:4310`. Agent-browser QA on the reference chat found 58 completed
KaTeX nodes, zero pending nodes, three fixed-layout tables, and no page or
console errors.

#### Manual validation checklist — nested math and wide tables

Run `bash .devcontainer/start-conduit.sh restart`, open the reference chat at
`http://127.0.0.1:4310/chat/ced1f475-6e71-4d91-9056-75f3f24e29ef`, and keep
Incremark with Typewriter enabled.

- Confirm inline formulas appear as complete equations. They must not grow
  one TeX character at a time.
- Confirm the transcript does not flash, oscillate, or move up and down when
  formulas appear in ordinary prose.
- Confirm tables use the available pane width on desktop. The first column
  must remain readable, and formulas must not force a final column reflow.
- During a long table response, compare the table while streaming with the
  final table. Column boundaries must stay in the same positions.
- Confirm formulas inside table cells appear complete and do not change row
  height after they appear.
- Switch to Marked and repeat one table and one inline-math response. Marked
  must remain selectable and its Typewriter control must stay disabled.
- Check for raw TeX, missing text, duplicate text, console errors, browser
  slowdown warnings, and blocked composer controls.

Expected result: nested inline math appears atomically, wide tables use spare
pane width without changing ordinary prose width, and no table-wide rerender
occurs when the provider completes.

#### Typewriter deterministic measurements

Commands ran from `conduit-web` with Chromium `149.0.7827.55` and Node
`v24.18.0`. The 1,200-character runs used 200 six-character deltas. Reports
contain no prompt or transcript bodies.

| Run | Completion ms | Display delay after provider completion | DOM mutations | Root records / added / removed | Long tasks / max task | Frame max gap | Typewriter result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Marked immediate, steady 1 ms | 979.5 | — | 190 | 2 / 2 / 0 | 0 / 0 ms | 49.9 ms | final 1,200 |
| Incremark immediate, steady 1 ms | 1,011.0 | — | 351 | 3 / 2 / 1 | 0 / 0 ms | 49.9 ms | final 1,200 |
| Incremark Typewriter, steady 1 ms | 1,056.5 | 60.7 ms | 258 | 1 / 1 / 0 | 0 / 0 ms | 33.3 ms | steady lag p95 4.84%; steady age p95 20.7 ms; max step 84 |
| Incremark Typewriter, burst 128 ms | 3,141.8 | 70.4 ms | 68 | 1 / 1 / 0 | 0 / 0 ms | 50.1 ms | max step 36; steady lag p95 9.09%; steady age p95 127.8 ms |
| Incremark Typewriter, jitter 5–80 ms | 8,526.5 | 55.9 ms | 406 | 1 / 1 / 0 | 0 / 0 ms | 33.4 ms | steady lag p95 1.14%; steady age p95 41.1 ms |
| Incremark Typewriter, 300 ms stall | 305.5 | 160.3 ms | 38 | 1 / 1 / 0 | 0 / 0 ms | 33.3 ms | no instant reveal; source gap 300.2 ms; max step 265 |

The final steady run reported source-rate p50 `1,251` characters/s, steady
relative-lag p95 `4.84%`, backlog-age p95 `20.7 ms`, zero steady-state lag
misses, and a maximum step of `84` characters per 16 ms frame. The burst run
reached a maximum step of `36` with zero Long Tasks. The jitter run stayed at
`1.14%` p95 relative lag and `41.1 ms` p95 backlog age. The stall run
preserved a non-instant `160.3 ms` display drain after a measured `300.2 ms`
WebSocket gap and produced zero Long Tasks. During the first frame after a
scripted burst or stall, relative lag can exceed 10% because the provider
delivers several deltas in one task. The steady-state target and backlog-age
measurements are the valid pacing evidence for those profiles.

The client delta coalescing change removed the earlier post-stall Long Task:
the pre-coalescing run recorded one `74 ms` task, while the final run recorded
none. It also reduced the burst DOM mutation count from the earlier `388` to
`72` in the current profile. This is measurable pacing and mutation improvement
for the tested stream, not proof that Incremark is a generally faster renderer.

For the current steady comparison, Marked produced `190` DOM mutations,
Incremark immediate produced `351`, and Typewriter produced `258`; Typewriter
and both immediate paths kept their outer root records at `1`, `2`, and `3`
respectively. The Typewriter path reduces visible mutation and root
replacement for this stream, but it does not prove lower total render cost than
Marked.

All measured text runs ended with exact source content, zero duplicate
characters, zero layout shifts, and a stable outer Markdown root. Rich
Markdown passed with structural equality and no Long Tasks. The KaTeX fixture
passed with two rendered equations and zero removed math nodes. The incomplete
math fixture passed with hidden pending math, zero pending text, stable pending
height, and no final pending node. The security fixture passed with unsafe
elements, unsafe protocols, and images absent. The reconnect Typewriter run
passed with final length `25`, zero duplicates, and a persistent outer root.
The 9,017-character math-stress fixture passed with final semantic length
`13,889`, 96 KaTeX nodes and adapter calls, zero removed math nodes, and exact
content equality against the immediate Incremark result. The Typewriter run
reported one `100 ms` Long Task, a `4,422.4 ms` display drain, p95 backlog age
`678.8 ms`, and 407 steady-state lag misses. The task and lag are caused by
the 96 atomic KaTeX nodes and their layout work, not ordinary-text Typewriter
pacing. This remains the known math-only limitation; the fixture gate is
`250 ms`, so the run passed its current safety threshold but does not meet the
stricter no-Long-Task/high-rate target for equation-heavy output.

#### Verification and remaining evidence

- `npm run typecheck`: passed.
- Focused controller and batching tests: passed with 12 tests, 0 failures.
  The controller tests cover EMA seeding, stall samples, lag and backlog
  formulas, no fixed 180-character cap, source-update step growth, frame-work
  limiting, fallback selection, and atomic math counting. The batching tests
  cover the 256-character same-block limit and structural boundaries.
- `npm test`: passed with 292 tests, 0 failures.
- `npm run build`: passed. The bundle report recorded initial JavaScript
  `128621 B gzip`, initial CSS `19422 B gzip`, and largest lazy JavaScript
  `185186 B gzip`. Initial JavaScript is 45.4% smaller than the earlier
  `235258 B gzip` result and is below the `180000 B` budget.
- The browser harness passed Typewriter steady, burst, jitter, stall,
  high-throughput math, rich Markdown, KaTeX, incomplete math, security, and
  reconnect scenarios. It also passed the immediate Marked and Incremark
  fixture baselines. The incomplete-math harness now waits for the renderer
  root to be attached, then waits for display-busy to clear; this matches the
  intentional empty math shell during deferred rendering.
- `npm run test:browser -- --project=desktop-chromium --workers=1` ran 90
  Chromium tests with 76 passed, 7 failed, and 7 skipped. The failures remain
  in the broad app suite: workspace dialog visibility, legacy Markdown stream
  fixtures, transient-chat menu contents, stop/checkpoint timing, a delayed
  checkpoint timeout, and a message-action payload shape. The
  Typewriter-specific deterministic harness and its renderer, math, security,
  and reconnect contracts passed separately. I did not change those adjacent
  app tests in this slice.
- `bash .devcontainer/start-conduit.sh restart`: passed with the normal
  repository command. `curl -fsS http://127.0.0.1:4310/healthz` returned
  `{"ok":true,"status":"ready","release":"development"}`. The listener
  is `0.0.0.0:4310`, so Windows can use `127.0.0.1:4310`.
- After the final restart, authenticated agent-browser checks passed on the
  reported mixed-math route. The temporary browser auth entry was deleted after
  QA. No transcript data was changed.

#### Manual checklist — typewriter mode

Run the managed server from the repository root, open
`http://127.0.0.1:4310`, authenticate, and select Incremark plus Typewriter.
Record pass or fail in this section. The deterministic harness already covers
the repeatable performance and semantic checks; this list covers user-visible
behavior.

- Stream prose, headings, lists, blockquotes, code, links, and tables. Look
  for missing text, duplicate text, raw Markdown, root flashing, and transcript
  jumps.
- Test steady, burst, jitter, a one-second provider stall, and a provider
  above 700-token/s equivalent. The output speed must increase without an
  instant catch-up flash, long freeze, or browser slow-tab warning.
- Confirm provider controls settle before the display finishes draining.
- Submit a follow-up while the prior answer drains. The prior answer must not
  reset or reveal instantly.
- Disable Typewriter. All buffered output must flush immediately. Re-enable it
  during a response. Existing content must not replay.
- Switch to Marked. Typewriter must be disabled and off. Switch back to
  Incremark. No old answer may replay unless Typewriter is enabled again.
- Reload and confirm the local Typewriter preference. Test URL overrides
  `markdownTypewriter=1` and `markdownTypewriter=0`.
- Test incomplete and completed inline and display math. Open math must stay
  invisible with stable height; closed math must appear once as complete KaTeX.
- Test stop, reconnect, scroll-follow, manual scroll-away, and hidden-tab
  pause/resume. Check for blocked controls, raw TeX, pending nodes that remain
  after completion, duplicate output, long tasks, and browser slowdown warnings.

Current conclusion: the inline-math stability work meets its focused
acceptance criteria. Completed inline math renders once, incomplete math stays
invisible, standard `$…$`, `$$…$$`, `\(…\)`, and `\[…\]` delimiters work, the
outer transcript root remains stable, and the exact response has no removed
math roots or Long Tasks. Typewriter remains an adaptive Incremark path and
Marked remains available and unchanged by the new table rules. The separate
96-equation math-stress profile still has the known one `100 ms` math/layout
Long Task and misses the relative-lag target while atomic equations drain.
The managed server is live and correctly bound. The broad 90-test Chromium
suite is not green because 7 adjacent app-suite tests fail; those failures are
outside this inline-math slice.

### Vertical oscillation diagnostic — 5 August 2026

The previous focused fixture did not explain the vertical movement seen in a
real response. This diagnostic keeps the exact requested prompt in
`test/browser/helpers/streaming-fixtures.js`:

`output some inline math with $ quotes, and some block math with $$ a lot of it, the inline interspersed with texta nd the blocks inebetween, add soem tables with a lot of info int them as well`

The deterministic answer fixture is `math-table-oscillation`. It contains
inline math before, inside, and after a five-column table. The run used
Chromium `149.0.7827.55`, Node `v24.18.0`, seed `1`, a steady `16 ms`
cadence, and three source characters per delta. The source answer length was
`1,088` characters. The harness now records parser table shape, table row and
cell identity, column geometry, math parent location, layout shifts, scroll
writes, and root mutations.

The harness also exposed and fixed a baseline error: the application default
enables Incremark Typewriter when no local preference exists, so the immediate
Incremark path was not immediate in the first comparison. The browser harness
now passes `markdownTypewriter=0` explicitly for immediate runs. This changed
test setup only; it did not change renderer behavior.

| Run | DOM mutations | Layout shifts / CLS | Block height / top reversals | Table layout transitions | Table structure transitions | Math geometry transitions | Long tasks | Scroll writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Marked immediate | 324 | 30 / `0.113399` | 0 / 0 | 38 (`auto`) | 7 | 0 | 0 | 382 |
| Incremark immediate | 9,173 | 1 / `0.0000097` | 1 / 0 | 1 | 1 | 2 | 1 (`144 ms`) | 588 |
| Incremark Typewriter | 1,080 | 1 / `0.0000100` | 26 / 45 | 3 (`empty → table → columns`) | 37 | 4 | 0 | 203 |

The Marked run is not a stability target. Its block geometry counters stay
stable, but its `table-layout: auto` table changes layout 38 times and
produces CLS `0.113399`. Copying that behavior would trade the current
vertical problem for large horizontal shifts and column reflow.

Incremark keeps the outer root stable and has far lower CLS, but the Typewriter
run still has the vertical failure. The AST evidence is append-only:

- At source characters `333`, the table has 1 row and 5 cells.
- At `339`, it has 2 rows and 10 cells.
- At `456`, `573`, `696`, and `822`, it grows to 3, 4, 5, and 6 rows.

The DOM evidence is not append-only. The table header keeps one identity, but
the body repeatedly replaces logical rows and cells. In the same run, the
active body row changes from identities `17` to `23` to `29`, then later from
`139` to `167` to `178`; each replacement also creates five new cell
identities. The table structure changes 37 times while the parser reports only
7 table-shape transitions. Row heights also move between `15`, `39.89`,
`64.78`, and `67.56` pixels as the incomplete row grows. This is the direct
cause now supported by evidence: a new AST row object causes the table's
`<For>` body reconciliation to replace DOM rows, so the transcript reflows
while the provider still appends to the same logical row.

The math geometry evidence does not show repeated table-cell geometry changes
in this run. It records four completed inline-math transitions, all with no
`tableCell` parent in the captured transition entries. Math is still a trigger
for the parser and row content, but the dominant measured mechanism is table
row and cell remounting, not repeated KaTeX replacement. The Typewriter
controller itself is within its pacing budget: backlog-age p95 was `75.1 ms`,
maximum backlog age was `161 ms`, frame-work p95 was `0.3 ms`, maximum frame
work was `0.8 ms`, no fallback mode activated, and no Long Task occurred. Its
display drain completed `138.7 ms` after provider completion. The latest run
recorded 206 transient lag-target misses, but its source-visible counter treats
math nodes as atomic and never reached the `500`-character steady-state
threshold; this is not evidence that ordinary prose pacing failed.

#### Measured next plan

1. Change only table subtree reconciliation. Preserve table, header, rows, and
cells across parser updates when their logical position is unchanged. The
current append-only evidence supports position-stable row and cell updates;
`Index`-style reconciliation or an equivalent logical row/cell key map should
update the active row in place and append only new rows. Do not freeze row
heights or copy Marked's auto table layout.

2. Rerun Marked immediate, Incremark immediate, and Incremark Typewriter on
this exact fixture. The acceptance evidence is zero body-row remounts for
unchanged logical rows, no block-top direction reversals, no repeated table
column transition after the table is established, and final semantic equality.
The active row may grow as content wraps; its height must not shrink and grow
because its DOM subtree was recreated.

3. If row identity becomes stable but the transcript still moves, add
per-logical-cell geometry evidence and separate two cases: active-cell text
growth versus KaTeX geometry changes. Only then adjust math placeholder or
column behavior. Do not add a two-line high-water placeholder or freeze table
geometry without a measured need.

4. Keep the existing 150% wide-table rule and fixed column hints during this
diagnostic. After row reconciliation is stable, test dynamic column sizing as
a separate experiment. A width change must be measured against the current
`0.000010` CLS baseline; it must not be mixed with row identity changes.

#### Cleanup and evidence scope

The ungrouped root project had 57 sessions: 38 visible chats and 19 empty
drafts. I preserved the reference chat
`ced1f475-6e71-4d91-9056-75f3f24e29ef` and deleted the other 37 active chats
and 19 drafts. The 8 grouped/workspace session sets were not touched. The
deleted sessions have no restore path in the application; the preserved
reference remains available. No separate benchmark file was created.

Verification for this diagnostic:

- `npm run typecheck`: passed after the harness baseline fix.
- `node --check test/browser/helpers/streaming-performance.js`: passed.
- `node --check test/browser/helpers/streaming-fixtures.js`: passed.
- `node --check test/browser/harness-streaming.spec.js`: passed.
- `git diff --check`: passed.
- Marked, immediate Incremark, and Incremark Typewriter runs all produced
  reports with exact source delivery and no removed completed math roots. The
  runs intentionally failed their old geometry gates: Marked failed the CLS
  and table-layout gates; immediate Incremark failed one block-height reversal;
  Typewriter failed the block-height and block-top reversal gates. These
  failures are the measurement result, not unverified claims.

No renderer fix was implemented in this diagnostic round. The next code
change should target table row and cell identity preservation first.

### Table tail reconciliation pass — 5 August 2026

The first table fix changed `TableNode` body rows from object-identity `<For>`
reconciliation to position-stable `<Index>` reconciliation. The exact fixture
showed that this was necessary but not sufficient: the native transformer can
return a shorter cached table slice after a source update, even when the
provider has only appended text. That made already visible rows disappear from
the current display node.

The Incremark adapter now keeps the previous active table display node by block
ID and merges it with the next table slice using append-only rules. Previously
visible rows and cells remain in the active tail when the native slice is
temporarily shorter. New rows and cells append at the end. Cell text also keeps
the longer prefix when the native slice temporarily regresses. This does not
freeze row heights, freeze column geometry, change math handling, or alter
Marked.

| Run | Before table-tail fix | After table-tail fix |
| --- | ---: | ---: |
| Exact Typewriter table-structure transitions | 33–37 | 9 |
| Exact Typewriter block-top reversals | 45–60 | 0 |
| Exact Typewriter block-height reversals | 26–31 | 2–7 |
| Exact Typewriter CLS | `0.000010` | `0.000010` |
| Exact Typewriter Long Tasks | 0 | 0 |

The remaining height reversals are in the prose/math blocks before the table.
The block evidence shows the table height only grows as rows and cell content
arrive. The remaining math transitions are the known text → invisible pending
math → completed KaTeX lifecycle. Synthetic closing delimiters remain a
separate future experiment; this pass keeps incomplete math invisible.

The screenshot-shaped `multiline-inline-math-table` fixture passed after the
change: source `1,265` characters, zero block-height reversals, zero block-top
reversals, CLS `0.001453`, zero Long Tasks, table structure transitions `8`,
and display completion delay `78.8 ms`. Its backlog-age p95 was `79.0 ms` and
maximum frame work was `0.9 ms`. The `rich-markdown` Typewriter regression
also passed with zero Layout Shifts, zero block reversals, zero Long Tasks, and
55 DOM mutations.

The larger `inline-math-table-stream` fixture remains outside the acceptance
gate: it recorded 76 block-height reversals and 128 block-top reversals, with
one Layout Shift entry and CLS `0.000098`. It has 24 rows and many inline
formulas. This confirms that the table fix removes the short-slice row loss in
the focused case, but the larger case still needs the separate inline-math
geometry work.

#### Verification

- `npm run typecheck`: passed.
- `git diff --check`: passed.
- `npm test`: passed, 293 tests and 0 failures.
- `npm run build`: passed. Initial JavaScript was `128.66 kB` gzip, initial
  CSS was `19.47 kB` gzip, and the largest lazy JavaScript was `185.19 kB`
  gzip.
- Exact `math-table-oscillation` Typewriter: table top reversals reached zero;
  the harness still failed the old global height-reversal gate because of
  inline math in earlier prose blocks.
- Exact immediate Incremark: one global height reversal, zero top reversals,
  zero Layout Shift entries, zero Long Tasks.
- `rich-markdown` Typewriter: passed.
- `multiline-inline-math-table` Typewriter: passed.
- `inline-math-table-stream` Typewriter: failed its existing geometry gate as
  recorded above. No threshold was weakened.

#### Manual smoke checklist — table tail reconciliation

Run `bash .devcontainer/start-conduit.sh restart` from the repository root,
open `http://127.0.0.1:4310`, select Incremark, and enable Typewriter.

- Use the exact table/math prompt from the diagnostic fixture with a live or
  deterministic response.
- Confirm rows already visible never disappear while the active row grows.
- Confirm the table keeps its column boundaries while new rows arrive.
- Confirm cell text does not reset, duplicate, or move to another row.
- Confirm formulas inside cells still remain invisible until their closing
  delimiter arrives, then appear once as complete KaTeX.
- Scroll at the bottom during generation. Look for table-wide jumps, upward
  jumps, flashing, or a browser slowdown warning.
- Repeat with the four-column multiline table. Check that its final layout
  matches its streaming layout.
- Switch to Marked and run one table response. Marked must remain unchanged;
  its Typewriter control must stay disabled.
- Check raw TeX, missing text, duplicate text, blocked composer controls,
  console errors, and final transcript equality.

### Inline math cell type-transition fix — 5 August 2026

The live probe found a separate failure from table geometry. With Incremark
Typewriter enabled, formula-only table cells could remain empty until a reload
or a Typewriter toggle. The parser produced the correct `inlineMath` nodes,
but the Solid adapter mounted a leaf component once and evaluated its plain
JavaScript `switch` only during creation. A text or pending leaf therefore did
not become `MathNode` when its AST type changed. The old `Switch` also received
function-valued `when` props, so it did not provide a reactive type boundary.

The adapter now uses a keyed Solid `Show` at the `AstNode` leaf boundary. It
remounts only when the AST node type changes and keeps same-type text updates
in place. `DisplayBlockNodes` now keys only by Incremark's stable block ID,
not by inferred shape. The table display normalizes Incremark's transient
empty paragraph fallback to the known table shape and merges it with the
append-only table history. This prevents a cache gap from remounting the
table, rows, cells, and already-rendered KaTeX.

The new deterministic fixture is `inline-math-cell-transition`. It requires
one table and exactly two rendered math nodes. The red run before the fix had
zero KaTeX calls, zero math cells, and failed the structural, KaTeX, and table
math assertions. The green run passed with:

| Measure | Result |
| --- | ---: |
| Final table math cells | 2 |
| Final KaTeX nodes | 2 |
| Removed completed math nodes | 0 |
| Root replacement records | 1 addition, 0 removals |
| Stable table identity | 1 table ID through all observed transitions |
| Layout Shift | 0 entries, CLS `0` |
| Long Tasks | 0 |
| Harness errors | 0 |

Related Typewriter fixtures also passed:

- `inline-math-table-stream`: 72 table math cells, zero removed math nodes,
  CLS `0.0000175`, zero Long Tasks.
- `multiline-inline-math-table`: 12 table math cells, zero removed math
  nodes, CLS `0.001453`, zero block-height or block-top reversals.
- `standard-math-delimiters`: two table math cells, zero Layout Shift entries.

The broader `math-table-oscillation` fixture still fails its existing global
block-height guard: 4 reversals versus the limit of 0. It renders all 15
table math cells, removes zero completed math nodes, records zero Long Tasks,
and has zero block-top reversals. This remains a separate inline-math geometry
risk; no threshold was weakened.

Verification for this fix:

- `npm test`: passed, 293 tests and 0 failures.
- `npm run typecheck`: passed.
- `npm run build`: passed. Initial JavaScript was `128.65 kB` gzip, initial
  CSS was `19.47 kB` gzip, and the largest lazy JavaScript was `185.19 kB`
  gzip.
- `git diff --check`: passed.
- Managed server restart passed. Health returned
  `{"ok":true,"status":"ready","release":"development"}`.
- Real local GPT-5.6 Luna minimal smoke with the exact table/math prompt,
  chat `12fb0cae-815c-4aef-86b0-dc9fd9f36b60`: Incremark Typewriter was
  checked; the completed DOM contained 3 tables, 44 table cells with KaTeX,
  72 KaTeX nodes, zero pending nodes, and no display-busy state.

#### Manual smoke checklist — inline math cells

- Select Incremark and enable Typewriter.
- Use the exact table/math prompt from this document with GPT-5.6 Luna
  minimal.
- During streaming, inspect formula-only cells. They must populate without a
  reload or Typewriter toggle.
- Confirm completed table rows and cells do not disappear or reset while the
  next row grows.
- Confirm formulas appear as complete KaTeX and raw TeX does not remain in
  completed cells.
- Scroll at the transcript bottom. Check for flashing, table replacement,
  duplicate text, missing text, and browser slowdown warnings.
- Stop and reload the chat. Confirm the final table and formulas remain equal.
- Switch to Marked. Confirm Marked remains unchanged and Typewriter is off and
  disabled.
- Test a valid `\(...\)` formula and a malformed unmatched delimiter. The
  valid formula must render; malformed source must remain literal or pending.
