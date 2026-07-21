# UI Parity Phases 2–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Workers are launched only through Claude Code's programmatic `Workflow` tool and must not spawn subagents or nested workflows.

**Goal:** Complete stable thinking presentation, transcript-native questions, server-owned Pi commands, and the six-tab settings/diagnostics information architecture while preserving the in-progress Phase 1 renderer work.

**Architecture:** Four workflow workers implement conflict-free focused modules and tests. The coordinator then integrates those modules through shared application, server, registry, browser-test, style, and documentation files. Pi JSONL remains transcript authority; resident process state owns interactive requests; session metadata owns normalized command data; diagnostics exposes a narrowed read-only projection.

**Tech Stack:** React 19, Vite, Express, Node.js `node:test`, Playwright, WebSocket, Pi RPC, Shadcn-owned controls.

## Global Constraints

- Preserve every current uncommitted Phase 1 file and its registry-based timeline dispatch.
- Run one layer of programmatic `Workflow` workers; workers must not call `Agent`, `Workflow`, or create worktrees.
- Keep timeline React keys durable and one component type per slot across state changes.
- Read mutable external stores during render only through `useSyncExternalStore`.
- Use Shadcn-owned controls; do not add bespoke primitives for styling.
- Pi JSONL remains the authoritative transcript. Do not persist fabricated reasoning or question history.
- A successful Pi `get_commands` response, including `[]`, is authoritative.
- The client hardcodes only `/attach`.
- Diagnostics is authenticated and read-only except for the existing Host Pi re-detection action.
- HTTP and WebSocket changes are additive and documented in `conduit-web/README.md`.
- Coordinator exclusively edits `main.jsx`, `chat-thread.jsx`, `command-registry.js`, `styles.css`, `pi-manager.js`, `server.js`, shared browser/API tests, and README integration.

---

## Worker Ownership

| Worker | Production ownership | Test ownership |
|---|---|---|
| Phase 2 | `src/client/reasoning-state.js`, `src/client/live-stream-store.js`, `src/client/reasoning-block.jsx`, `src/client/reconcile-messages.js`, `src/session-store.js` | `test/reasoning-state.test.js`, `test/reasoning-event-order.test.js`, `test/live-stream-store.test.js`, `test/session-store.test.js`, `test/reconcile-messages.test.js` |
| Phase 3 | `src/client/interactive-request-state.js`, `src/client/interactive-request-card.jsx`, `src/client/question-card.jsx`, `src/activity.js`, `src/client/timeline-order.js` | `test/interactive-request-state.test.js`, `test/activity.test.js`, `test/timeline-order.test.js` |
| Phase 4 | `src/pi-command-catalog.js`, `src/client/chat-composer.jsx`, `src/client/slash-suggestions.jsx` | `test/pi-command-catalog.test.js` |
| Phase 5 | `src/diagnostics.js`, `src/client/diagnostics-settings.jsx`, `src/client/settings-dialog.jsx` | `test/diagnostics.test.js`, `test/runtime-settings.test.js` |

All paths in the table are relative to `conduit-web/`.

---

### Task 1: Freeze the Phase 1 baseline

**Files:**
- Inspect only: `AGENTS.md`
- Inspect only: `conduit-web/README.md`
- Inspect only: `conduit-web/src/client/chat-thread.jsx`
- Inspect only: `conduit-web/src/client/tool-registry.js`
- Test: `conduit-web/test/tool-registry.test.js`
- Test: `conduit-web/test/tool-summary.test.js`

**Interfaces:**
- Consumes: existing `timelineItemRenderers`, `registerTimelineItemRenderer`, `toolRenderers`, `registerToolRenderer`, `setDefaultToolRenderer`, `getToolRenderer`.
- Produces: a recorded baseline status and passing Phase 1 focused tests.

- [ ] **Step 1: Record the dirty baseline**

Run:

```bash
git status --short
git diff -- conduit-web/src/client/chat-thread.jsx conduit-web/test/browser/app.spec.js AGENTS.md conduit-web/README.md
```

Expected: the known Phase 1 tracked and untracked files are present; no Phase 2–5 implementation files exist yet.

- [ ] **Step 2: Run Phase 1 focused tests**

Run:

```bash
cd conduit-web
node --test test/tool-registry.test.js test/tool-summary.test.js
```

Expected: PASS. If either fails, preserve the failure output and do not reinterpret it as a Phase 2–5 regression.

---

### Task 2: Implement the stable reasoning core

**Files:**
- Create: `conduit-web/src/client/reasoning-state.js`
- Modify: `conduit-web/src/client/live-stream-store.js`
- Modify: `conduit-web/src/client/reasoning-block.jsx`
- Modify: `conduit-web/src/client/reconcile-messages.js`
- Modify: `conduit-web/src/session-store.js`
- Create: `conduit-web/test/reasoning-state.test.js`
- Create: `conduit-web/test/reasoning-event-order.test.js`
- Modify: `conduit-web/test/live-stream-store.test.js`
- Modify: `conduit-web/test/session-store.test.js`
- Modify: `conduit-web/test/reconcile-messages.test.js`

**Interfaces:**
- Consumes: generation events with `generationId`; Pi assistant `content` blocks; existing `createLiveStreamStore()` and message reconciliation.
- Produces:

```js
createInitialReasoningState() => null
reduceReasoningState(state, event, now = Date.now()) => null | {
  generationId,
  status: "active" | "completed",
  content,
  redacted,
  startedAt,
  completedAt,
  durationSeconds,
  observed,
}
```

Persisted assistant messages gain:

```js
message.reasoning = {
  status: "completed",
  content: string,
  redacted: boolean,
  durationSeconds: number | null,
  observed: true,
}
```

- [ ] **Step 1: Characterize the late acknowledgement race**

Write `test/reasoning-event-order.test.js` around the Pi fixture/request seam so one stdout chunk contains the successful prompt response followed by `agent_start`, `message_start`, `thinking_start`, and `thinking_delta`. Assert that client events can observe the early thinking events before `generation_started`.

Run:

```bash
cd conduit-web
node --test test/reasoning-event-order.test.js
```

Expected: PASS as a characterization of current ordering.

- [ ] **Step 2: Write the failing same-generation stream test**

Add:

```js
const store = createLiveStreamStore();
store.append("g1", "early");
store.start("g1");
assert.equal(store.getSnapshot().content, "early");
store.start("g2");
assert.equal(store.getSnapshot().content, "");
```

Run:

```bash
node --test test/live-stream-store.test.js
```

Expected before implementation: FAIL because `start("g1")` clears `early`.

- [ ] **Step 3: Make `start()` idempotent for the same generation**

Implement the semantic equivalent of:

```js
start(generationId, initialContent = "") {
  if (state.generationId === generationId) return;
  update({ generationId, content: initialContent });
}
```

Preserve notification behavior for genuinely new generations. Re-run `test/live-stream-store.test.js`; expected PASS.

- [ ] **Step 4: Write reducer tests**

Cover: empty active slot; thinking accumulation; redaction; same-generation late `generation_started`; stale events; `thinking_end`; transition to text without deletion; generation completion duration; genuinely new generation replacement.

Use injected timestamps:

```js
state = reduceReasoningState(null, { type: "thinking_start", generationId: "g1" }, 1_000);
state = reduceReasoningState(state, { type: "thinking_end", generationId: "g1", content: "kept" }, 3_400);
assert.equal(state.durationSeconds, 2);
```

Run `node --test test/reasoning-state.test.js`; expected FAIL until the module exists.

- [ ] **Step 5: Implement the pure reducer**

Normalize `event.delta`/`event.content`, never expose `thinkingSignature`, preserve state for same-generation acknowledgement/text events, and ignore stale generation IDs. Re-run `test/reasoning-state.test.js`; expected PASS.

- [ ] **Step 6: Project authoritative persisted reasoning**

Add tests for ordered thinking blocks, redacted blocks, no thinking blocks, and missing/malformed timestamps. `messagesFromEntries()` must concatenate only `block.type === "thinking"` values and derive duration only from available authoritative generation/message timestamps. Extend `sameMessage()` and reconciliation so authoritative reasoning updates are adopted without changing durable message keys.

Run:

```bash
node --test test/session-store.test.js test/reconcile-messages.test.js
```

Expected: PASS.

- [ ] **Step 7: Update `ReasoningBlock` without changing its element type**

Use:

```jsx
ReasoningBlock({
  content = "",
  active = false,
  redacted = false,
  durationSeconds = null,
})
```

The outer `.reasoning-block` always renders when the caller supplies a reasoning slot. Use `Thinking…` while active and `Thought for N s` after completion. Render an expander only when `content && !redacted`; otherwise show a non-interactive summary row.

Run the complete Phase 2 worker matrix; expected PASS.

---

### Task 3: Implement transcript-native question modules

**Files:**
- Create: `conduit-web/src/client/interactive-request-state.js`
- Create: `conduit-web/src/client/interactive-request-card.jsx`
- Create: `conduit-web/src/client/question-card.jsx`
- Modify: `conduit-web/src/activity.js`
- Modify: `conduit-web/src/client/timeline-order.js`
- Create: `conduit-web/test/interactive-request-state.test.js`
- Modify: `conduit-web/test/activity.test.js`
- Modify: `conduit-web/test/timeline-order.test.js`

**Interfaces:**
- Consumes: normalized `extension_ui_request`/host UI events and Phase 1 `registerTimelineItemRenderer()`.
- Produces:

```js
normalizeInteractiveRequest(event, { timestamp, seq })
mergeInteractiveRequestSnapshot(current, incoming)
markInteractiveRequestSubmitting(current, requestId, response)
resolveInteractiveRequest(current, requestId, response = null)
failInteractiveRequest(current, requestId, message)
```

`buildTimeline(messages, tools, { streaming = false, requests = [] } = {})` emits stable `type: "question"` items.

- [ ] **Step 1: Write request lifecycle tests**

Cover select, confirm, input, and editor normalization; exclude fire-and-forget methods; preserve first timestamp/sequence; and cover `pending → submitting → resolved`, remote resolution, correlated error, and retry.

Run `node --test test/interactive-request-state.test.js`; expected FAIL until implementation exists.

- [ ] **Step 2: Implement the pure lifecycle module**

Use stable records:

```js
{
  id,
  kind,
  title,
  message,
  options,
  placeholder,
  prefill,
  timeoutMs,
  status,
  response,
  error,
  timestamp,
  seq,
}
```

Merge by request ID and never delete resolved resident-process history. Re-run the lifecycle tests; expected PASS.

- [ ] **Step 3: Add timeline tests and integration**

Assert `buildTimeline(..., { requests })` creates:

```js
{
  type: "question",
  value: request,
  index,
  order,
}
```

with stable request-derived ordering and no duplicate items. Update activity normalization to use one consistent request shape. Run `node --test test/activity.test.js test/timeline-order.test.js`; expected PASS.

- [ ] **Step 4: Build one reusable card component**

`InteractiveRequestCard({ request, onSubmit })` renders the same outer component for pending, submitting, resolved, and error states. Select/confirm use Shadcn buttons; input/editor expose text entry; resolved state shows only authoritative response data; error state keeps retry available.

- [ ] **Step 5: Register the question renderer at module load**

`question-card.jsx` exports and registers:

```js
registerTimelineItemRenderer("question", QuestionTimelineItem);
```

The renderer receives generic props:

```jsx
QuestionTimelineItem({ item, sessionId, onRespond })
```

Do not edit `chat-thread.jsx` in the worker. Run the Phase 3 worker matrix; expected PASS.

---

### Task 4: Implement the Pi command catalog and composer seams

**Files:**
- Create: `conduit-web/src/pi-command-catalog.js`
- Modify: `conduit-web/src/client/chat-composer.jsx`
- Modify: `conduit-web/src/client/slash-suggestions.jsx`
- Create: `conduit-web/test/pi-command-catalog.test.js`

**Interfaces:**
- Consumes: Pi RPC `get_commands`, selected template manifest, prompt templates, skills, optional explicit extension command metadata.
- Produces:

```js
normalizeRpcCommands(commands) => PublicPiCommand[]
discoverTemplateCommands({ templateDir, manifest }) => Promise<PublicPiCommand[]>
resolvePiCommandCatalog({ rpcCommands, templateDir, manifest, hostMode = false }) => Promise<PublicPiCommand[]>
```

```js
{
  name,
  description,
  source: "extension" | "prompt" | "skill",
  dispatch: "insert" | "prompt",
}
```

- [ ] **Step 1: Write catalog contract tests**

Cover RPC order, first-wins duplicate names, successful empty RPC authority, stripping `sourceInfo`, prompt-template parsing, recursive `SKILL.md` parsing, malformed/missing resources, optional static extension metadata, and empty Host Pi fallback.

Run `node --test test/pi-command-catalog.test.js`; expected FAIL until implementation exists.

- [ ] **Step 2: Implement normalized RPC commands**

Map `prompt` to `dispatch: "insert"`; map `extension` and `skill` to `dispatch: "prompt"`. Remove leading slashes, reject empty names, preserve first occurrence, and never return paths or `sourceInfo`.

- [ ] **Step 3: Implement safe manifest fallback**

Read prompt-template and skill metadata only. Extension commands may come only from explicit static manifest metadata such as:

```json
{
  "extensionCommands": [
    { "name": "command-name", "description": "Public description" }
  ]
}
```

Do not execute or regex-parse extension source. A missing/malformed source contributes no commands. A successful RPC result—including `[]`—bypasses fallback.

Re-run `test/pi-command-catalog.test.js`; expected PASS.

- [ ] **Step 4: Add composer selection seams**

Extend slash descriptors with `dispatch` and `text`. Preserve client actions such as `/attach`. Add an explicit text-send seam so direct dispatch does not depend on asynchronous draft state:

```js
sendText(text, options)
```

For `insert`, replace the active slash token and retain focus. For `prompt`, call the explicit send seam with `/${name}`. Run existing composer/chat-action tests available to the worker without editing coordinator-owned tests.

---

### Task 5: Implement safe diagnostics and exact settings content

**Files:**
- Create: `conduit-web/src/diagnostics.js`
- Create: `conduit-web/src/client/diagnostics-settings.jsx`
- Modify: `conduit-web/src/client/settings-dialog.jsx`
- Create: `conduit-web/test/diagnostics.test.js`
- Create: `conduit-web/test/runtime-settings.test.js`

**Interfaces:**
- Consumes: public installation records, narrowed process views, projects, and configured storage roots.
- Produces:

```js
projectDiagnostics({ installations, processes, projects, config }) => {
  installations: [...],
  processes: [...],
  storage: {
    dataRoot,
    transcriptRoots,
    uploadRoots,
  },
}
```

Client `DiagnosticsSettings()` owns only load/error/retry and Host Pi re-detection refresh.

- [ ] **Step 1: Write the safe-projection tests**

Assert exact allowed key sets and explicit absence of installation commands/args, environment variables, credentials, queues, host UI contents, transcript filenames, arbitrary config fields, workspace allowlists, and directory listings.

Run `node --test test/diagnostics.test.js`; expected FAIL until implementation exists.

- [ ] **Step 2: Implement the pure projection**

Return only installation identity/detection fields, safe process activity fields, and derived root paths. Do not spread input records. Build every response row explicitly.

Re-run `test/diagnostics.test.js`; expected PASS.

- [ ] **Step 3: Lock runtime persistence**

Write a temporary runtime settings file, save normalized values through `RuntimeSettingsStore`, instantiate a second store, reload, and assert `maxLiveProcesses`, `maxGeneratingProcesses`, and `idleProcessTtlMs` survive. Change production runtime settings code only if the test exposes a defect.

Run `node --test test/runtime-settings.test.js`; expected PASS.

- [ ] **Step 4: Replace placeholder settings navigation**

Use exactly:

```js
[
  { id: "profiles", label: "Profiles" },
  { id: "workspaces", label: "Workspaces" },
  { id: "models", label: "Models" },
  { id: "runtime", label: "Runtime" },
  { id: "auth", label: "Auth" },
  { id: "diagnostics", label: "Diagnostics" },
]
```

Remove General, Appearance, Connections, About, and all `Not available yet` panels. Runtime keeps only the three editable process-policy controls.

- [ ] **Step 5: Build read-only Diagnostics UI**

Render installation version/path/detection rows, live process activity/client/generation rows, and storage roots. Include retry and existing Host Pi re-detection. Do not render settings inputs or a save button in Diagnostics. Run the Phase 5 worker matrix; expected PASS.

---

### Task 6: Run the four-worker implementation workflow

**Files:**
- Read: `specs/ui-parity-phases-2-5-design.md`
- Read: `specs/ui-parity-phases-2-5-plan.md`
- Modify: only worker-owned files from Tasks 2–5.

**Interfaces:**
- Consumes: the ownership table and task contracts above.
- Produces: four worker reports listing changed paths, tests run, results, and integration assumptions.

- [ ] **Step 1: Launch one programmatic workflow**

The script must use one `parallel()` call with four `agent()` calls. Each prompt must include its exact ownership list, TDD deliverables, focused test commands, current workspace path, and these prohibitions:

```text
Do not call Agent or Workflow.
Do not spawn subagents.
Do not create a worktree.
Do not commit, reset, stage, or edit coordinator-reserved files.
Preserve existing uncommitted Phase 1 work.
```

- [ ] **Step 2: Wait for all four reports**

Require each report to state:

```text
Changed files
Tests run and exact result
Known integration assumptions
Anything intentionally left for coordinator
```

- [ ] **Step 3: Verify ownership**

Run `git status --short` and `git diff --name-only`. If a worker touched a coordinator-reserved or another worker's file, inspect and reconcile before continuing.

---

### Task 7: Integrate reasoning and interactive questions

**Files:**
- Modify: `conduit-web/src/client/main.jsx`
- Modify: `conduit-web/src/client/chat-thread.jsx`
- Modify: `conduit-web/src/client/styles.css`
- Modify: `conduit-web/src/pi-manager.js`
- Modify: `conduit-web/src/server.js`
- Modify/Delete after import removal: `conduit-web/src/client/host-ui-card.jsx`
- Modify: `conduit-web/test/tool-registry.test.js`
- Modify: `conduit-web/test/pi-template.test.js`
- Modify: `conduit-web/test/browser/app.spec.js`

**Interfaces:**
- Consumes: Phase 2 reducer/persisted reasoning and Phase 3 lifecycle/card/timeline modules.
- Produces: session-scoped live reasoning, resident request history, answer-bearing resolution events, generic renderer callback wiring, header attention, and browser-verified stable DOM identity.

- [ ] **Step 1: Integrate reasoning state in `main.jsx`**

Replace the global transient reasoning object with reducer state keyed by current session/generation. Feed every generation-scoped event through `reduceReasoningState()`. Do not clear same-generation reasoning on late `generation_started`, text start, `agent_end`, or runtime idle. Reset only on chat reset or a genuinely new generation.

- [ ] **Step 2: Render live and persisted reasoning in `chat-thread.jsx`**

Persisted rows read `message.reasoning`; the live assistant row reads the live reducer state. Keep the same assistant row key and `ReasoningBlock` component through startup, thinking, text, and finalization.

- [ ] **Step 3: Retain server-owned interactive request history**

In `pi-manager.js`, maintain unresolved `hostUiRequests` for activity plus resident `interactiveRequests` containing pending/resolved records. On response acknowledgement, remove from unresolved state, retain the resolved record, and broadcast:

```js
{
  type: "extension_ui_resolved",
  requestId,
  value,
  confirmed,
  cancelled,
}
```

Include only the response field actually provided. Correlated send failures include `requestId`.

- [ ] **Step 4: Add snapshot/request integration**

Add `interactiveRequests` to runtime snapshots. In `main.jsx`, merge snapshots by ID, mark local submissions `submitting`, resolve only on acknowledgement, and route correlated errors to the matching card.

- [ ] **Step 5: Preserve registry-only rendering**

Import `question-card.jsx` for module-load registration. Pass `onRespond` as a generic optional renderer prop:

```jsx
<ItemRenderer
  item={item}
  sessionId={sessionId}
  onRespond={onRespondInteractiveRequest}
/>
```

Do not add `if (item.type === "question")`. Update the registry test to require a question renderer while preserving the tool renderer assertions.

- [ ] **Step 6: Remove the detached host UI surface**

Remove the composer-adjacent `HostUiRequests` rendering and its final import. Delete `host-ui-card.jsx` only when no references remain. Derive the header unresolved count from pending/submitting/error request records.

- [ ] **Step 7: Add focused browser tests**

Test strict `.reasoning-block` node identity through late acknowledgement and finalization. Test question option and free-text payloads, submitting/frozen states, remote resolution, error/retry, strict card node identity, and header attention.

Run:

```bash
cd conduit-web
node --test test/tool-registry.test.js test/pi-template.test.js
npx playwright test test/browser/app.spec.js -g "reasoning|question|interactive request"
```

Expected: PASS.

---

### Task 8: Integrate server commands and settings diagnostics

**Files:**
- Modify: `conduit-web/src/pi-manager.js`
- Modify: `conduit-web/src/server.js`
- Modify: `conduit-web/src/client/main.jsx`
- Modify: `conduit-web/src/client/command-registry.js`
- Modify: `conduit-web/src/client/styles.css`
- Modify: `conduit-web/test/pi-template.test.js`
- Modify: `conduit-web/test/server-api.test.js`
- Modify: `conduit-web/test/chat-actions.test.js`
- Modify: `conduit-web/test/browser/app.spec.js`

**Interfaces:**
- Consumes: Phase 4 catalog/composer seams and Phase 5 projection/settings UI.
- Produces: session command metadata, unified composer/palette entries, `GET /v0/diagnostics`, exact six-tab palette, responsive diagnostics.

- [ ] **Step 1: Add the Pi RPC wrapper**

Implement:

```js
async getCommands(id) {
  const data = await this.request(id, { type: "get_commands" });
  return Array.isArray(data.commands) ? data.commands : [];
}
```

Test the exact request payload and successful empty result.

- [ ] **Step 2: Add command metadata to session responses**

`GET /v0/sessions/:id` returns fallback catalog data before the process is live. Live start/session responses replace it with normalized authoritative RPC data. Never serialize `sourceInfo` or local source paths.

- [ ] **Step 3: Unify composer and palette command mapping**

Extend `availableComposerCommands({ commands = [], ...context })` to map server commands into descriptors with `id`, `slash`, `label`, `description`, `keywords`, `dispatch`, and `text`. Keep `/attach` even when `commands` is empty. Add a Pi Commands palette page/source using the same `context.commands` array.

- [ ] **Step 4: Wire command state and exact dispatch**

Load/reset commands with session detail, template/runtime changes, and live-start authoritative replacement. Insert prompt-template commands into the draft; send extension/skill command text directly through the prompt channel using the explicit text-send seam.

- [ ] **Step 5: Add authenticated diagnostics endpoint**

Add `GET /v0/diagnostics` after auth middleware. Call `projectDiagnostics()` with public installation data and narrowed manager/project/config data. Test exact response keys and authentication.

- [ ] **Step 6: Reconcile exact settings palette**

Set `SETTINGS_SECTIONS` to exactly `profiles`, `workspaces`, `models`, `runtime`, `auth`, `diagnostics` in that order. Invalid section fallback becomes `profiles`, not removed `general`.

- [ ] **Step 7: Add focused API/registry/browser tests**

Cover RPC preference, fallback metadata, path stripping, `/attach`, composer/palette parity, insertion/direct send, exact settings tabs and palette order, Runtime PATCH persistence, Auth retention, Diagnostics fields, failure/retry, forbidden controls, and 480px layout.

Run:

```bash
cd conduit-web
node --test test/pi-template.test.js test/server-api.test.js test/chat-actions.test.js
npx playwright test test/browser/app.spec.js -g "slash|command|palette|settings|runtime|diagnostics|Auth"
```

Expected: PASS.

---

### Task 9: Consolidate documentation and shared styles

**Files:**
- Modify: `AGENTS.md` only if a new durable contributor invariant is required.
- Modify: `conduit-web/README.md`
- Modify: `conduit-web/src/client/styles.css`

**Interfaces:**
- Consumes: final HTTP, WebSocket, command, reasoning, request, Runtime, and Diagnostics behavior.
- Produces: stateless current-system documentation and responsive presentation.

- [ ] **Step 1: Update the runtime/API documentation once**

Document:

- reasoning remains assistant-message-owned;
- `interactiveRequests` snapshot history and answer-bearing `extension_ui_resolved` events;
- correlated `client_error.requestId`;
- session/live command metadata shape;
- `GET /v0/diagnostics` response and safety boundary;
- Runtime versus Diagnostics responsibilities.

Preserve the Phase 1 tool registry/Shiki documentation already present.

- [ ] **Step 2: Add only required styles**

Style `.reasoning-block`, interactive request states, header attention, Diagnostics rows, storage paths, and narrow layout. Reuse tokens and existing Shadcn classes. Do not alter unrelated surfaces.

- [ ] **Step 3: Check documentation and CSS diff**

Run:

```bash
git diff --check -- AGENTS.md conduit-web/README.md conduit-web/src/client/styles.css
```

Expected: no whitespace errors and no obsolete placeholder documentation.

---

### Task 10: Verify, run, capture, and ship

**Files:**
- Verify: all changed files.
- Generate locally but do not commit: Playwright screenshots/traces unless intentionally attached to the PR through supported repository conventions.

**Interfaces:**
- Consumes: the complete integrated implementation.
- Produces: verified branch, managed running server, screenshots, coherent commits, pushed branch, and draft PR.

- [ ] **Step 1: Run the focused Node matrix**

```bash
cd conduit-web
node --test \
  test/tool-registry.test.js \
  test/tool-summary.test.js \
  test/reasoning-event-order.test.js \
  test/live-stream-store.test.js \
  test/reasoning-state.test.js \
  test/session-store.test.js \
  test/reconcile-messages.test.js \
  test/interactive-request-state.test.js \
  test/activity.test.js \
  test/timeline-order.test.js \
  test/pi-command-catalog.test.js \
  test/chat-actions.test.js \
  test/diagnostics.test.js \
  test/runtime-settings.test.js \
  test/pi-installations.test.js \
  test/process-policy.test.js \
  test/pi-template.test.js \
  test/server-api.test.js \
  test/auth-store.test.js \
  test/auth-server.test.js
```

Expected: all tests PASS.

- [ ] **Step 2: Run the full Node suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run browser tests**

```bash
npm run test:browser
```

Expected: desktop and mobile projects PASS. Inspect every emitted trace if a failure occurs.

- [ ] **Step 4: Build within existing budgets**

```bash
npm run build
```

Expected: PASS with no bundle-budget increase.

- [ ] **Step 5: Restart the managed server**

From repository root:

```bash
bash .devcontainer/start-conduit.sh restart
```

Expected: managed server reports healthy on port 4310.

- [ ] **Step 6: Perform manual smoke tests and capture screenshots**

At the configured local Conduit URL:

1. Start a response with thinking and verify one stable row becomes `Thought for N s`.
2. Trigger a select and free-text request; verify transcript placement, header attention, local answer freeze, and remote resolution behavior.
3. Type `/`; verify descriptions, insertion commands, direct commands, `/attach`, and equivalent command-palette entries.
4. Open Settings; verify exactly six tabs, editable Runtime, retained Auth, read-only Diagnostics, process rows, installation rows, storage roots, retry, and narrow viewport behavior.

- [ ] **Step 7: Run final preservation checks**

Verify:

```text
generic timelineItemRenderers[item.type] dispatch remains
default tool renderer and tool registration remain
reasoning is not registered as a tool
chat-thread.jsx has no question-specific type branch
no detached host UI card remains
settings tab order is exact
no command source paths reach the client
no forbidden diagnostics fields reach the client
Phase 1 tests, browser coverage, and docs remain
```

- [ ] **Step 8: Commit coherent changes**

Review `git diff` and split commits by coherent outcome where practical without separating dependent shared integration. Do not include credentials, `data/`, logs, `dist/`, `node_modules/`, or generated traces.

- [ ] **Step 9: Push and open a draft PR**

Push `feat/ui-parity` and create a draft PR against `main`. The PR body must summarize phases 1–5 present in the branch, list exact verification commands/results, include UI screenshots, and call out additive protocol/API fields and resident-process request-history semantics.
