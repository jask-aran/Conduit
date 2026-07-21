# Spec: Interface parity pass

Status: draft · Priority: 2 · Independent phases; each phase is its own PR
with disjoint file ownership so they can proceed in parallel.

## Goal

Close the gaps between Conduit's chat renderer and a first-class agent
interface: legible tool calls, honest thinking presentation, native components
for interactive Pi tools, full `/command` parity with terminal Pi, and a
settings surface without blank tabs.

## Phase 1 — Generic tool-call card v2 (legibility)

The current generic tool block is illegible for arbitrary tools. Replace with
one flexible card used by every tool that lacks a native renderer:

- Header: tool name, one-line smart summary of arguments (first meaningful
  scalar/path, truncated), live status (pending → running → done/error) and
  duration once complete.
- Arguments: collapsed by default; expanded view pretty-prints JSON with
  Shiki, long strings clamped with reveal.
- Result: collapsed by default, lazy-fetched on expand (existing behavior
  preserved); render text as text, JSON pretty-printed, errors in a
  destructive-toned block.
- Tool names remain data. The generic card must render unknown tools without a
  renderer registry; native interactive requests use their protocol type at the
  host-UI boundary rather than registering tool-name components.
- Timeline stability rules from `AGENTS.md` apply: one element type per slot
  across the streaming→final lifecycle.

## Phase 2 — Thinking presentation

Two defects:

1. **Startup flicker**: at chat start the thinking indicator mounts,
   unmounts, and remounts. Diagnose the event ordering in
   `state/live-stream.ts`/timeline mapping before fixing (systematic:
   reproduce with a logged event trace, identify which transition unmounts the
   slot). Expected shape of fix: a stable per-generation thinking slot that
   appears once and transitions in place — never keyed off transient delta
   presence.
2. **No persistent summary**: once a response completes, thinking vanishes.
   Keep a collapsed "Thought for _N_ s" row above the assistant message,
   expandable to the recorded thinking content when the JSONL retains it;
   omit the expander (duration only) when it does not. Honor vision invariant
   13: render only what Pi actually emitted, never synthesize.

## Phase 3 — Native component: the question tool

First interactive tool renderer. The plumbing already exists: Pi's
interactive requests arrive as `extension_ui_request` events, are answered
with the `extension_ui_response` / `host_ui_response` WS commands, appear in
`hostUiRequests` on runtime snapshots, and drive the `waiting_for_user`
activity. What's missing is presentation: render the request as a native card
in the transcript — question text, option buttons (direct Solid controls), free-text
fallback where the request allows it — instead of the current generic host-UI
handling. Submitting sends the existing response command and freezes the card
to show what was chosen; resolved requests (`extension_ui_resolved`) freeze
cards from other connected clients too. Unanswered questions surface in the
chat header (and later feed the shell-level attention signal — vision S8).
Design the card so the next interactive request types (approvals) reuse it.

## Phase 4 — /command parity

Terminal Pi exposes slash commands from extensions, skills, and prompt
templates; the web composer exposes only `/attach`. Reach parity:

- Server: enumerate available commands for a chat's template/installation
  (investigate Pi RPC first — if the RPC surface reports commands, use it;
  otherwise derive from the template manifest's prompt templates, skills, and
  extensions) and expose them on the existing chat metadata endpoint.
- Composer: the slash popover lists them with descriptions; selection either
  inserts the command text (prompt-template style) or dispatches through the
  prompt channel exactly as terminal Pi would receive it. Palette gains the
  same entries under a page source.
- Contract: commands are data from the server; the client hardcodes only
  `/attach`.

## Phase 5 — Settings overhaul

Fill the blank tabs and settle the information architecture:

- **Profiles** (exists) · **Workspaces** (exists) · **Models** (exists) —
  polish only.
- **Runtime**: warm pool, generation caps, idle TTL (currently env-only —
  surface `data/runtime.json` read/write).
- **Auth**: from `edge-auth.md`.
- **Diagnostics**: installations (Isolated/Host Pi paths, versions, detection
  results), live process table, storage locations. Read-only.

Every tab either renders real content or does not exist; no placeholders.

## Verification

Per phase: focused node tests for new server endpoints/stores, browser tests
for each new interaction (tool card expand, thinking persistence, question
answer round-trip via mocked API, slash popover contents, settings tabs),
`npm run build` within bundle budgets. Screenshots in each PR.
