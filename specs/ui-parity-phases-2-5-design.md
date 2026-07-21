# UI parity phases 2–5 design

**Status:** Approved for implementation  
**Source contract:** `specs/ui-parity.md` phases 2–5  
**Delivery:** One coordinated branch and draft PR, preserving the in-progress Phase 1 renderer registry

## Goal

Complete the remaining interface-parity work in one coordinated delivery: stable and honest thinking presentation, transcript-native interactive questions, server-owned Pi slash commands, and a settings surface with only functional tabs.

The implementation must preserve Pi JSONL as transcript authority, keep timeline identities stable, use the Phase 1 renderer registries for non-message timeline items, and retain the existing WebSocket command contracts.

## Coordination model

Use Claude Code's programmatic `Workflow` tool to launch one layer of narrow implementation agents. The workflow script performs the fan-out and collects each worker's result; workers must not call `Agent`, `Workflow`, or otherwise spawn subagents. Parallel work is divided by feature-specific modules and focused tests; the coordinator owns shared integration files, cross-phase browser tests, documentation, conflict resolution, and final verification.

- **Phase 2 worker:** reasoning lifecycle/state and focused tests.
- **Phase 3 worker:** native question timeline component and focused tests.
- **Phase 4 worker:** command discovery, metadata, composer/palette plumbing, and focused tests.
- **Phase 5 worker:** settings information architecture, diagnostics, and focused tests.
- **Coordinator:** `main.jsx`, shared registries where ownership overlaps, `test/browser/app.spec.js`, documentation, integration, and release verification.

Workers may modify overlapping files only when unavoidable. Their reports must identify every changed path and any integration assumptions. The coordinator reconciles all shared-file edits after the workflow returns.

## Phase 2: stable thinking presentation

### State and identity

Reasoning state is scoped to a generation or durable assistant-message identity rather than held as one transient global object. A generation receives one stable reasoning slot at generation start. The slot remains the same React element type and key through thinking, text streaming, finalization, and persisted rendering.

The slot's visibility must not depend on whether the latest event contains a thinking delta. Event transitions update its props rather than mount or replace it.

### Lifecycle

The reasoning slot progresses through:

1. active with no content yet;
2. active with emitted thinking content;
3. completed with measured duration;
4. persisted collapsed summary above the assistant response.

The completed label is `Thought for N s`. If Pi JSONL retains emitted thinking content, the row can expand to show exactly that content. If content is absent or redacted, the row shows duration without an expansion control. Conduit must not synthesize or summarize hidden reasoning.

### Diagnostics and tests

Before changing behavior, capture the event sequence responsible for the current mount/unmount/remount cycle. Add focused tests for event transitions, durable identity, completion duration, retained content, and content-absent summaries. Browser coverage must verify that the same DOM slot survives startup and thinking-to-text transitions.

## Phase 3: transcript-native questions

### Timeline model

Host and extension UI requests become stable non-message timeline items registered through Phase 1's `timelineItemRenderers`. `chat-thread.jsx` must not gain a question-specific branch. The same card component remains mounted from unanswered through locally or remotely resolved state.

### Reusable interaction component

Create a reusable interactive-request card contract suitable for questions now and approvals later. The question renderer displays:

- request prompt;
- Shadcn option buttons;
- free-text input only when the request allows it;
- pending, submitting, resolved, and error states;
- the selected or entered answer after resolution.

Submitting uses the existing `extension_ui_response` or `host_ui_response` WebSocket command. A local submission freezes the card after acknowledgement. An `extension_ui_resolved` event from another client resolves and freezes the same local timeline item.

### Attention signal

The chat header displays an attention indicator/count whenever unresolved requests exist. Resolving the final request clears the signal. The current detached generic host-UI surface is removed or reduced so there is only one interaction model.

### Durability

Runtime snapshots must reconstruct unresolved cards. Resolved cards remain in the in-memory transcript for the current session. Persisted reload behavior must render only request/answer information available from authoritative Pi/session data; the client must not fabricate historical resolutions.

### Tests

Cover option selection, permitted free text, exact WebSocket response payloads, local freeze, remote resolution, header attention, runtime-snapshot restoration, and stable card identity.

## Phase 4: server-owned slash commands

### Command catalog

Add a server-side command catalog normalized to a stable shape containing at least name, description, source, and dispatch behavior. Discovery order is:

1. query the selected Pi installation's authoritative RPC command surface when available;
2. otherwise derive commands from the selected template's prompt templates, skills, and extensions.

The fallback parser must fail safely on missing or malformed optional manifests and must not execute extension code merely to enumerate commands. Duplicate names are resolved deterministically, preferring authoritative RPC data and then the template's declared source order.

### API and refresh

Expose the normalized catalog additively on the existing session metadata response. The catalog is scoped to the session's selected template and Pi installation. Changing either causes the client to receive/refetch the matching catalog.

### Composer and palette

`/attach` remains the only client-owned command. Slash suggestions merge it with server commands, display descriptions, and preserve filtering and keyboard navigation.

Selecting a prompt-template-style command inserts its command text for further editing. Commands that terminal Pi receives directly are sent through the existing prompt channel with equivalent text. The command palette consumes the same normalized session catalog through a page/source rather than duplicating entries.

### Tests

Cover RPC preference, manifest fallback for each source type, malformed optional data, deterministic deduplication, metadata serialization, session scoping, slash descriptions and selection, direct dispatch versus insertion, palette parity, and `/attach` availability without server data.

## Phase 5: settings completion

### Information architecture

Visible settings tabs are exactly:

- Profiles
- Workspaces
- Models
- Runtime
- Auth
- Diagnostics

General, Appearance, Connections, About, and any other placeholder-only tabs are removed from settings navigation and the command palette. Every visible tab renders real content.

### Runtime

Runtime remains the editable home for warm-pool size, concurrent-generation cap, and idle reclaim TTL. Values continue to read and write through `data/runtime.json` using the existing runtime settings API and atomic store.

### Auth

Auth retains the behavior implemented from `specs/edge-auth.md`, including status and session reset controls. No parallel auth configuration model is introduced.

### Diagnostics

Diagnostics is read-only and presents:

- Isolated Pi and Host Pi executable paths, agent-home paths, versions, sources, and detection outcomes;
- live process rows with safe operational fields such as session identity, state, installation, client count, and generation status;
- relevant storage locations for Conduit data, transcripts, uploads, and installation homes.

Installation diagnostics move out of Runtime so editable policy and read-only inspection have clear boundaries. Existing safe runtime endpoints should be reused when sufficient; API additions must be additive and omit secrets, credentials, environment values, and unrestricted filesystem data.

### Existing surfaces

Profiles, Workspaces, and Models receive only parity-related polish needed for consistent navigation and empty/loading/error states. This phase does not redesign their underlying data models.

### Tests

Cover the exact visible-tab set, absence of placeholders, command-palette parity, Runtime persistence, Auth behavior retention, installation diagnostics, live-process rows, storage locations, read-only controls, narrow viewport layout, and safe API response fields.

## Shared integration and error handling

- External mutable stores are read through `useSyncExternalStore`.
- Timeline items keep durable keys and one component type across state transitions.
- WebSocket and HTTP changes are additive and documented in `conduit-web/README.md`.
- Failed question submissions remain actionable and show an inline retryable error.
- Command discovery failures return an empty server catalog plus `/attach` on the client; they do not break session loading.
- Diagnostics load failures are isolated to Diagnostics with a retry action; they do not disable other settings tabs.
- Existing Phase 1 changes in `chat-thread.jsx`, the renderer registry, Shiki loader, tool cards, tests, and docs must be preserved.

## Verification and delivery

Run focused node tests throughout implementation, then:

1. `npm test`
2. targeted Playwright tests for phases 2–5
3. full `npm run test:browser`
4. `npm run build` with unchanged bundle budgets
5. managed server restart from repository root
6. manual browser smoke test covering thinking, questions, slash commands, and all settings tabs

Capture UI screenshots for the draft PR. Commit coherent implementation changes, push the isolated branch, and open one draft PR describing all four phases, verification commands, screenshots, and any API/session-lifecycle effects.
