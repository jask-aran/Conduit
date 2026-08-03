# Issues #24 and #34 implementation

Status: Slice 1 complete at `024ce4c`. Slice 2 committed at `6a713f2`.
Slice 3 committed at `288db80`. Slice 4 committed at `296d822`. Slice 5
Marked baseline is recorded below. Slice 6 committed at `0e4d366`; Issue #24
remains open.

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

If the Slice 6 evidence is promising, run the work defined by Slice 4 and
Slice 5 before Slice 7: verify live boundary and recovery behavior, then run
the renderer-specific Marked baseline and the equivalent candidate comparison.
Only then hold the Slice 7 decision gate. If the spike is not promising, run
the required Slice 4 and current-renderer Slice 5 checks needed to document
the rejection; do not treat the local switch as adoption evidence. Slice 8
remains blocked on explicit owner approval.

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
| Markdown completion | `incomplete-heading`, `incomplete-emphasis`, `incomplete-link`, `incomplete-list`, `incomplete-table`, `incomplete-fence`, `incomplete-reference` |
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
- Incomplete Markdown makes parser-safe chunking and escaped-tail strategies
  visibly unstable, which is why the previous Marked approach was rejected.
- Incremark may reduce cumulative parser work through block boundaries and
  stable block IDs, but its documented raw-HTML mode and built-in rendering
  options do not prove Conduit security or artifact compatibility.
- An incremental renderer may improve parser cost while changing output timing,
  DOM identity, link controls, code rendering, KaTeX, or final reconciliation.

Unknowns include exact package versions and dependency graph, output behavior
for incomplete constructs, reference definitions, custom artifact controls,
sanitisation boundaries, stable node identity, and production bundle impact.

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

### Slice 7 — #24 decision gate and focused tests

Choose one outcome: reject Incremark, augment the current renderer for a
bounded live-only case, or propose adoption. Update #24 with the evidence and
request owner approval before any production renderer change.

Worker boundary: evidence synthesis, focused tests that preserve a decision,
and the issue update only. Do not implement a renderer outcome in this slice.

Acceptance:

- The decision names compatibility, security, identity, visible cadence,
  persistence, and bundle evidence.
- Rejected capabilities and remaining gaps are explicit.
- Focused tests cover every behavior that influenced the decision.
- No renderer replacement occurs without owner approval.

Verification: review the report and issue update; rerun the focused fixture
set; run the full repository checks for any committed test changes.

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
- **Security:** preserve DOMPurify restrictions, protocol checks, external-link
  confirmation, image removal, and artifact behavior. Incremark raw HTML is a
  hard review gate.
- **Markdown compatibility:** cover incomplete syntax, GFM, KaTeX, fenced
  code, reference definitions, links, long tokens, thinking, and tools.
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

The Slice 6 candidate gate was not promising. Slice 4 boundary and recovery
verification is complete, and Slice 5 now records the current Marked renderer
baseline. Slice 7 is next for the renderer decision gate. Any renderer
adoption still requires a separate owner approval after the Incremark spike.
