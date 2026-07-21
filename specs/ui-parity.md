# Spec: Interface parity pass

Status: **phases 1–5 implemented on `feat/ui-parity`** (commit 88e3edc), landed
under a shortened "least-effort, non-broken" cycle — see **Left behind** below
for the deferred work · Priority: 2.

This is the single source for the interface-parity pass. It absorbs the former
`ui-parity-phases-2-5-design.md` and `ui-parity-phases-2-5-plan.md` (now
deleted): the behavior spec, the locked implementation decisions, the shipped
status per phase, and what the shortened cycle left behind.

## Goal

Close the gaps between Conduit's chat renderer and a first-class agent
interface: legible tool calls, honest thinking presentation, native components
for interactive Pi tools, full `/command` parity with terminal Pi, and a
settings surface without blank tabs.

## Locked implementation decisions

Decisions taken during implementation that constrain future work:

- The Phase 1 renderer registry (`src/client/tool-registry.js`) is the sole
  extension point. `timelineItemRenderers[item.type]` dispatches the timeline
  loop; `toolRenderers`/`getToolRenderer(name)` resolves a tool card with a
  generic fallback. New non-message item types register at module load — no
  `if (item.type === …)` branches in `chat-thread.jsx`.
- Reasoning belongs to the assistant message, not a tool/timeline renderer.
  Live reasoning is a single generation-scoped reducer state; persisted
  reasoning is projected onto `message.reasoning`.
- Phase 2 duration is **total generation elapsed time**, not thinking-only
  time — it must be reconstructable from persisted JSONL timestamps after a
  reload, and thinking-only spans are not recorded there.
- Phase 3 interactive requests are retained only for the **resident process
  lifetime** (server `record.interactiveRequests`, echoed on runtime
  snapshots). Cold reload does not fabricate question history from JSONL.
- Phase 4 treats a successful `get_commands` RPC result — including `[]` — as
  authoritative. Fallback never executes or regex-parses extension source;
  extension commands come only from explicit static manifest metadata
  (`extensionCommands`).
- Phase 5 Diagnostics is authenticated and read-only except for the existing
  Host Pi re-detection action.

## Phase 1 — Generic tool-call card v2 (legibility) · shipped

One flexible card for every tool without a native renderer:

- Header: tool name, one-line smart summary of arguments (first meaningful
  scalar/path, truncated), live status (pending → running → done/error) and
  duration once complete.
- Arguments: collapsed by default; expanded view pretty-prints JSON with
  Shiki (shared lazy singleton in `shiki-highlight.js`), long strings clamped.
- Result: collapsed by default, lazy-fetched on expand from
  `GET /v0/sessions/:id/tools/:toolId`; text as text, JSON pretty-printed,
  errors in a destructive-toned block.
- A renderer registry maps tool name → component, defaulting to this card.
  No switch statements in the timeline.
- Timeline stability rules from `AGENTS.md` apply: one element type per slot
  across the streaming→final lifecycle.

Files: `tool-registry.js`, `tool-card.jsx`, `tool-summary.js`,
`tool-json-block.jsx`, `shiki-highlight.js`, `code-block.jsx`.
(Phase 1 was reviewed separately; it is committed with phases 2–5 because
2–5 build directly on its registry.)

## Phase 2 — Thinking presentation · shipped

Two defects, both addressed:

1. **Startup flicker** — root cause was an ordering race: Pi's acknowledged
   prompt and its first agent events (`agent_start`, `message_start`,
   `thinking_start/delta`) arrive in one stdout chunk, so `generation_started`
   is published *after* early thinking events. The old code reset reasoning and
   restarted the live stream on that late `generation_started`, unmounting the
   slot. Fix: `live-stream-store.js` `start()` is now idempotent for the same
   generation (preserves already-buffered content), and reasoning is a pure
   generation-scoped reducer (`reasoning-state.js`) that ignores stale/late
   acknowledgement instead of clearing.
2. **Persistent summary** — a single stable slot per generation transitions in
   place to a collapsed `Thought for N s` row above the assistant message,
   expandable to recorded thinking when the JSONL retained it, duration-only
   (no expander) otherwise. Redacted/empty reasoning stays mounted but
   non-expandable; `thinkingSignature` is never exposed. The row renders only
   when Pi actually emitted thinking (`observed`), never synthesized.

Files: `reasoning-state.js`, `reasoning-block.jsx`, `live-stream-store.js`,
`reconcile-messages.js`, `session-store.js`; integrated in `main.jsx` /
`chat-thread.jsx`. Tests: `reasoning-state`, `reasoning-event-order`,
`live-stream-store`, `session-store`, `reconcile-messages`.

## Phase 3 — Native component: the question tool · shipped

Blocking Pi interactive requests (`extension_ui_request` for select / confirm /
input / editor) render as native `question` timeline items via the registry —
question text, Shadcn option buttons, free-text for input/editor only. One
stable card across pending → submitting → resolved / error. Submitting sends
the existing `extension_ui_response` / `host_ui_response` command and freezes
the card; a remote `extension_ui_resolved` freezes it on other clients too.
The server retains resolved requests in `record.interactiveRequests` and
answer-bearing resolution events broadcast the chosen value. Unanswered
requests raise a count in the chat header. The card contract is generic so
future approval requests reuse it. The previous detached host-UI card is
removed (`host-ui-card.jsx` deleted).

Files: `interactive-request-state.js`, `interactive-request-card.jsx`,
`question-card.jsx`, `activity.js`, `timeline-order.js`; integrated in
`main.jsx`, `chat-thread.jsx`, `pi-manager.js`, `server.js`. Tests:
`interactive-request-state`, `activity`, `timeline-order`.

## Phase 4 — /command parity · shipped

Slash commands beyond `/attach` are server data:

- Server enumerates commands via Pi's `get_commands` RPC when a process is
  live; otherwise derives from the selected template's prompt templates,
  skills, and declared `extensionCommands`. Normalized to
  `{ name, description, source, dispatch }` and exposed as a `commands` array
  on `GET /v0/sessions/:id` and the live-session response.
- Composer slash popover lists them with descriptions; `dispatch: "insert"`
  (prompt templates) replaces the token, `dispatch: "prompt"` sends the text
  through the prompt channel via an explicit `sendText` seam (no stale draft).
  The palette gains the same entries.
- Contract: commands are server data; the client hardcodes only `/attach`.

Files: `pi-command-catalog.js`, `chat-composer.jsx`, `slash-suggestions.jsx`;
integrated in `pi-manager.js` (`getCommands`), `server.js`, `main.jsx`,
`command-registry.js`. Tests: `pi-command-catalog`.

## Phase 5 — Settings overhaul · shipped

Six real tabs, no placeholders:

- **Profiles · Workspaces · Models** — existing, polish only.
- **Runtime** — warm pool, generation caps, idle TTL via `data/runtime.json`.
- **Auth** — from `edge-auth.md`.
- **Diagnostics** — read-only `GET /v0/diagnostics`: installations
  (Isolated/Host Pi paths, versions, detection), live process rows, storage
  roots. Omits commands/args, env, credentials, queues, host-UI content, and
  transcript filenames. Host Pi re-detection lives here now.

General / Appearance / Connections / About and their palette entries are
removed. Invalid section IDs fall back to Profiles.

Files: `diagnostics.js`, `diagnostics-settings.jsx`, `settings-dialog.jsx`;
integrated in `server.js`, `command-registry.js`, `main.jsx`. Tests:
`diagnostics`, `runtime-settings`.

## Verification (as landed)

- `npm test` — 200 node tests pass.
- `npm run test:browser` — 58 pass, 2 skipped (desktop + mobile), existing
  suite adapted to the new IA.
- `npm run build` — within bundle budgets (~178 KB gz initial JS).

## Left behind (shortened cycle)

The branch was landed under an explicit "least-effort, non-broken" directive.
The feature cores and their focused unit tests are complete and green, but the
full plan's finishing steps were not, and two client wirings were reverted to
keep existing tests passing. Outstanding:

1. **No Playwright coverage for the new surfaces.** Reasoning DOM-identity
   across the lifecycle, question answer round-trip / remote resolution /
   retry, slash insertion vs prompt dispatch, and the Diagnostics tab are
   covered by unit tests only. Existing browser tests were adapted so they
   pass, not extended. This is the largest gap.
2. **Brand-new draft chats don't load slash commands until the process goes
   live.** The new-chat `loadDetail` wiring was reverted (it fired un-mocked
   session GETs that broke tests). Commands populate on `openLive` and when
   opening an existing session; a fresh unsent draft shows only `/attach` until
   the first message starts the process.
3. **Aggregate "N live / N generating" counts dropped from Runtime** and not
   re-added elsewhere. Diagnostics shows per-process rows but not the aggregate
   the Runtime tab used to display.
4. **Host Pi shows no fallback commands.** Host mode returns commands only from
   a live `get_commands` RPC; template fallback is disabled for host mode by
   design, so a host chat lists nothing until its process is live.
5. **Extension slash commands require explicit manifest metadata.** No shipped
   template declares `extensionCommands`, so extension-sourced commands are
   absent until a template opts in (parsing extension source was rejected as
   unsafe).
6. **Dead `.host-ui-card` CSS** remains in `styles.css` after the component was
   deleted (harmless; remove on next pass).
7. **`AGENTS.md` interface invariants not extended** for the question /
   command / diagnostics contracts. `conduit-web/README.md` documents them; the
   `AGENTS.md` interface section still only carries the Phase 1 registry note.
8. **No PR handback ritual.** Committed to the branch only — not pushed, no
   screenshots, and the managed-server restart + manual smoketest checklist
   from the plan were not performed.
9. **Reasoning duration semantics.** `Thought for N s` is total generation
   elapsed, not thinking-only time (a deliberate, reload-reconstructable
   choice). A reader may expect thinking-only; revisit if it misleads.
