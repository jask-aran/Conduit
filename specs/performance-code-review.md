# Conduit Performance Code Review

**Target:** `jask-aran/Conduit` `main` at `c8257ad0206a68fb0453bcd2af61d7e90fa21eed`; all findings re-verified against that checkout on 2026-07-23 (file/line references below resolve against it)  
**Scope:** Application/server bounded-work and lifecycle correctness outside the Transcript/Live Response rendering design  
**Companion document:** `rendering-state-architecture.md`

## Review decision

Request changes on bounded-work architecture.

The Solid rewrite is a genuine improvement: state ownership is substantially clearer, navigation uses load-then-commit with stale-request protection, timeline identity is deliberately preserved, and the production payload is healthy. The remaining concern is not Solid or ordinary component quality. Several application and server paths still perform work proportional to the total size of data or host resources when the user only needs a small current view.

The Transcript and Live Response have their own architectural review because their problems form one cohesive redesign: preserving Pi's structured events, reducing them into one Active Generation, batching fine-grained updates, bounding Markdown work, and making WebSocket reconnect/backpressure converge on structured Resume State. This review does not duplicate those findings. Both documents request changes and should be handed to the implementation agent together.

## Findings

### [P1 — implemented 2026-07-23] 1. Transcript pagination still reads and parses the entire JSONL

Conduit now builds an append-aware per-file offset and metadata index during
registry reconciliation. Selected-chat transcript reads load only the requested
turn window; model/thinking and attachment-announcement lookups reuse indexed
metadata; live launch validates only the bounded header. Normal append extends
the index, incomplete final lines remain uncommitted, and truncation,
replacement, or prefix changes rebuild it. The client treats the byte cursor as
an internal detail and automatically prepends history near the top while
preserving the visible scroll anchor. Explicit full-transcript export and
deferred single-tool-result retrieval may still scan the complete authoritative
JSONL because those are user-requested whole-history lookups, not ordinary chat
opening. Selected-chat bootstrap applies the model and thinking level already
returned with that transcript page, performs one runtime-aware model catalogue
request, and does not repeat that request after WebSocket attachment.

#### Maintained guarantees

- Serving the same ten-turn tail from a transcript 10× larger does not parse approximately 10× as many lines or bytes.
- Selected-chat open does not independently derive model state twice.
- Concurrent append during a read never returns malformed partial JSON as a committed entry.
- Index invalidation is covered for truncation/replacement, external append, and normal Pi append.
- Tests measure bytes/lines parsed and number of file scans; wall-clock-only assertions are too noisy.

### [P2 — implemented 2026-07-23] 2. Host-Pi preflight uses a metadata-only safety traversal

Host-Pi preflight now performs a metadata-only safety traversal. It retains
symlink refusal and the 10,000-entry/100 MiB limits, but derives aggregate size
from `lstat` and never opens or hashes resource files. The unused fingerprint
and its implied change-detection semantics were removed rather than cached.

#### Maintained guarantees

- Repeated Host-Pi launch performs no resource content-tree reads.
- Symlink escape, file-count, and aggregate-size protections remain enforced.
- Tests distinguish metadata traversal from bytes read; no cache or invalidation
  path exists because no change-detection result is consumed.

### [P2 — implemented 2026-07-23] 3. Optional startup work delays selected-chat initialization

Direct chat routes now request catalogue context, chat metadata, and transcript
concurrently. Capabilities, templates, and Pi installation status settle
independently without gating chat initialization or live attachment; Settings
shows explicit loading states if opened before templates or installations
arrive. Workspace suggestions use a single-flight request started only when the
workspace-creation surface opens. Root-route draft creation still awaits the
template catalogue because the configured default profile is required input.

`App.onMount()` (main.tsx:287-319) awaits a `Promise.all` of projects, capabilities, templates, workspace suggestions, and Pi installation data before starting route-specific chat loading — the chat detail fetch sits inside the `.then`, so it cannot begin until the slowest of the five settles. Some of that work can enumerate the filesystem or load host model/auth configuration. None of it is required to render the transcript of an already-selected chat.

Verified nuance: outright *failure* of the optional endpoints does **not** block startup — capabilities, templates, suggestions, and installations each carry a `.catch()` fallback, and only `/v0/projects` (genuinely required) can fail the boot. The real defect is head-of-line blocking on **slowness**: a slow home-directory enumeration or host Pi inspection delays the most important route even though the selected chat's identity is already available from the URL.

#### Required direction

Treat application startup as progressive, with dependencies expressed per surface:

- Load the minimal catalogue/project context and selected transcript first.
- If the selected chat is live, attach its WebSocket as soon as route identity and required auth are known.
- Start capabilities and templates concurrently, but do not gate transcript rendering unless a specific required field is genuinely absent.
- Fetch workspace suggestions only when the user opens workspace creation or a surface that displays them.
- Fetch Pi installation/model/auth detail when Settings or a runtime selector needs it.
- Keep the existing independent failure isolation (the `.catch()` fallbacks) when restructuring; do not regress it.
- Deduplicate requests when a deferred surface is opened while a background fetch is already in flight.

This does not require making every request lazy. Small stable catalogue data may still be prefetched; the key rule is that unrelated optional work must not sit on the selected-chat critical path.

#### Acceptance criteria

- Artificially delaying installation and workspace-suggestion endpoints does not delay first selected-transcript render.
- Optional endpoint failure does not prevent chat navigation or live attachment (already true today; keep it covered).
- Opening Settings after deferred startup still shows a coherent loading state and eventually the same data.
- Request-count tests ensure progressive loading does not create duplicate fetches.

### [P2] 4. Workspace Git inspection can stack expensive, unbounded child-process work

`conduit-web/src/workspace-inspector.js::readWorkspaceDiff()` (workspace-inspector.js:72) starts five Git commands concurrently for every request — status, unstaged diff, staged diff, branch, log — then up to two more for upstream divergence. The output buffers are capped (`maxBuffer` 64 KiB–4 MiB), but the processes have no execution timeout, cancellation signal, or per-project single-flight boundary. `git status --untracked-files=all` and full staged/unstaged diffs can still traverse a very large working tree before producing or exceeding those buffers.

The client compounds this. `WorkspacePanel::loadDiff()` (workspace-panel.tsx:47) does not reject an invocation while one is already running, and the refresh button (workspace-panel.tsx:101) remains active under the loading overlay. Repeated clicks can therefore start several sets of Git processes against the same repository. Closing the panel or navigating away does not abort the server work.

The inspector is explicitly secondary UI. It should not be able to consume an open-ended number of child processes or keep expensive repository scans alive after there is no consumer.

#### Required direction

- Add a server-side per-project single-flight operation for Git inspection. Concurrent requests should share the in-flight result or receive a clear busy response, rather than start another scan.
- Set explicit execution timeouts and terminate the complete child-process tree on timeout or request cancellation.
- Thread request abort/disconnect through the route into `readWorkspaceDiff()`.
- Avoid asking Git for the full patch until the user opens the patch disclosure, or split lightweight status/branch/log from the expensive diff body.
- Keep output caps, but do not mistake `maxBuffer` for a computation bound.
- Disable or coalesce refresh while a request is active. Cache a recently completed snapshot briefly if manual refresh and tab activation would otherwise duplicate it.

#### Acceptance criteria

- Repeated refresh clicks produce at most one active inspection per project.
- Closing the panel or disconnecting the request terminates work that has no remaining consumer.
- A deliberately slow Git command times out and leaves no child process behind.
- The initial Diff tab can show status, branch, changed-file summary, and recent commits without calculating a multi-megabyte patch unless that patch is requested.

### [P2] 5. Workspace-panel requests can commit stale project data after navigation

`conduit-web/src/client/workspace/workspace-panel.tsx` resets local state when `props.projectId` changes (workspace-panel.tsx:72-77), then launches `loadDirectory()` or `loadDiff()`. Those requests carry no `AbortSignal` or request-generation token. File previews and expanded-directory requests have the same issue. A response for the previous project can arrive after the reset and write its directory listing, preview, diff, or error into the new project's panel.

The single `loading` boolean (workspace-panel.tsx:20) is also not valid for overlapping operations: it is shared by `loadDirectory`, `loadFile`, and `loadDiff`, so whichever settles first clears `loading` even though another is still active. On unmount, the resize cleanup removes only the body class (workspace-panel.tsx:70); an in-progress resize leaves its `pointermove` listener attached until the next `pointerup` anywhere fires the once-registered stop handler.

This is the same load-then-commit discipline that the main chat navigation now handles well (`active-chat.ts` navigation/selection tokens), but it has not been carried into the newly added inspector.

#### Required direction

- Give each project selection an abort scope or monotonically increasing request generation. A result may commit only if its project ID and generation are still current.
- Abort outstanding directory, file, and diff requests when the panel closes or the project changes.
- Model loading per operation, or use a reference-counted/request-keyed pending set; do not use one boolean for unrelated concurrent reads.
- Remove both resize listeners during component cleanup, not only the CSS class.
- Preserve already loaded entries while refreshing the same project, but never preserve data across project identity changes.

#### Acceptance criteria

- Delaying project A's responses, switching to project B, and then releasing A never displays A's paths, preview, diff, or error under B.
- Concurrent directory and preview loads keep the appropriate busy state until both settle.
- Unmount during pointer resize removes all window listeners.

### [P2] 6. A network clone holds the global project-mutation lock indefinitely

`ProjectStore::createCloned()` executes the entire `gh repo clone`/`git clone` operation inside `runExclusive()` (project-store.js:266-317). That queue also serializes workspace create, rename, update, and removal. A slow or stalled network clone therefore blocks every unrelated project mutation for as long as the child process remains alive.

`runCommand()` (project-store.js:34) has no timeout or abort support and accumulates stdout/stderr into unbounded strings. If the HTTP client disconnects, the clone continues. The broad serialization avoids slug/catalog races, but it couples that necessary short critical section to an unbounded external process.

#### Required direction

Split clone creation into short serialized transitions around an external operation:

1. Under the mutation queue, validate current catalogue state, reserve the slug/path with an operation identity, and persist or retain an explicit in-progress reservation.
2. Release the queue while running the clone with a timeout, bounded diagnostic output, and abort handling.
3. Re-enter the queue to commit the project row if the reservation still matches.
4. On failure or cancellation, clean only the exact reserved target and release the reservation.

If persistent reservations are considered excessive for this single-process application, an in-memory reservation is acceptable, but restart recovery must safely recognize and remove only Conduit-owned partial clone directories.

#### Acceptance criteria

- A stalled clone does not prevent renaming or creating an unrelated workspace.
- Client disconnect or configured timeout terminates the child and cleans the exact partial target.
- Concurrent clone/create requests cannot claim the same slug or target.
- Child stdout/stderr retention is capped while preserving a useful terminal error excerpt.

### [P2] 7. Auth-store writes are atomic but not concurrency-safe

`AuthStore::_flush()` (auth-store.js:136) correctly writes a unique temporary file and renames it atomically, but mutations are not serialized or guarded by a version. Several request paths can replace or mutate the shared `this.data` and then independently serialize it. Two concurrent logins, session touches, logout/reset operations, or a forced password-file reload can therefore write different snapshots; the older logical snapshot may rename last and discard a newer session change.

Verified, and worse than the write race alone: `createSession()` and `verifyPassword()` both call `load({ force: true })` (auth-store.js:162, :168), which **replaces `this.data` wholesale from disk**. A concurrent mutation that has not yet flushed is discarded in memory at that moment — no rename race required. The login flow (verify → create) therefore already interleaves destructively with any concurrent touch/logout.

This is easy to miss because each individual file write is crash-safe. Atomic replacement prevents a torn JSON file, but it does not provide ordering between concurrent read-modify-write operations, and forced reloads are themselves a mutation of shared state.

#### Required direction

- Put every auth read-modify-write transition behind one store-owned mutation queue, as distinct from read-only password verification.
- Perform the final state derivation inside that queue; do not capture a stale object before waiting for it. Forced reloads count as transitions and belong in the queue.
- If external CLI edits must coexist with the server, use file identity/mtime or an explicit revision to detect and merge/reject stale commits rather than silently overwriting them.
- Keep password hashing (scrypt, deliberately slow) outside the short file-commit section where possible, while revalidating the revision before applying the result.

#### Acceptance criteria

- Parallel successful logins retain both sessions subject only to the documented `MAX_SESSIONS` policy.
- Concurrent touch/logout/reset operations have deterministic ordering and cannot resurrect a removed session.
- Tests deliberately delay temporary-file writes so the opposite completion order cannot lose the newer logical mutation.
- A forced reload interleaved with an unflushed mutation loses neither.

### [P3] 8. One test couples the unit suite to a client build

`test/auth-server.test.js` ("loopback bind without a password starts open and serves the SPA") asserts 200 from the SPA route, which serves `dist/`. On a fresh checkout without `npm run build`, it fails with 404 and makes an otherwise-green suite look broken (verified: 151/152 pass pre-build, 152/152 post-build). Either build a stub `dist/index.html` fixture in the test, skip with a clear message when `dist/` is absent, or document the build prerequisite in the test script.

## Companion rendering/state findings

The companion architecture review separately requests changes for:

- the bridge discarding Pi's assistant-message/content-block structure;
- whole-document Markdown work that becomes approximately quadratic while streaming;
- reasoning deltas bypassing frame batching, rebuilding the full visual projection, and scheduling scroll work per token;
- completion being reconstructed through several competing commits;
- lossy, capped reconnect replay; and
- WebSocket fan-out lacking coalescing and a per-client backpressure boundary.

Those are intentionally not restated here. WebSocket backpressure remains in the rendering/state document because its safe recovery mechanism depends on the same Active Generation and Resume State design; implementing it independently against the flattened stream would create another temporary protocol.

Note that the companion's interim-text question is now **settled** (owner decision, 2026-07-23): interstitial text before/after tool calls displays chronologically inside the Thinking Summary, classified from Pi structure rather than the current timestamp heuristics. See `rendering-state-architecture.md` § "Settled interim-text contract".

## Overall assessment

The rewrite materially improved the foundation. Re-verified on 2026-07-23 against `c8257ad`:

- Catalogue, global-runtime, and active-chat ownership are now comprehensible.
- Navigation follows load-then-commit and guards against stale requests.
- Timeline and Markdown reconciliation deliberately preserve DOM identity.
- The production split is healthy and matches the earlier numbers exactly: **114.59 kB gzip initial JS**, **15.40 kB initial CSS**, **103.55 kB lazy Markdown/KaTeX**, **4.08 kB lazy workspace panel** (from `scripts/check-bundle.mjs` output).
- Typecheck is clean and all **152 server/unit tests** pass — after a client build; see finding 8.

There is no architectural case for further bundle-size work before the bounded I/O and streaming fixes. The lazy Markdown chunk is large because it contains the parsing, math, and sanitization stack, but it is correctly off the initial path. The issue identified in the companion review is repeated runtime work over growing Markdown, not the chunk's transfer size.

Browser tests were not run during this verification pass (the environment constraint was no app instancing; the earlier review's environment lacked the Playwright Chromium binary). Either way the successful unit/server suite should not be interpreted as browser-level validation of rendering stability, progressive startup, or reconnect behaviour.

## Recommended implementation coordination

These findings are independently implementable, but coordinate interfaces with the rendering/state work:

1. Define the bounded session access layer before modifying each route separately; all transcript/model/validation consumers should converge on it.
2. Remove selected-chat bootstrap duplication while that layer is introduced (`/v0/sessions/:id` already returns model settings; make the client consume them).
3. Make startup progressive without changing the Live Response state model; live attachment should simply begin earlier once prerequisites are met.
4. Simplify Host-Pi preflight independently. It should not block or broaden the streaming migration.
5. Bound workspace inspection and clone processes through a shared child-process execution policy, while retaining separate per-feature state machines.
6. Carry the existing stale-request discipline into WorkspacePanel and serialize auth-store mutations.
7. Run the companion rendering/state sequence for Pi protocol preservation, Active Generation, Resume State, fine-grained rendering, and transport bounds.

Avoid combining these into one new global state subsystem. They solve different boundaries: bounded durable reads, route dependency scheduling, native-resource validation, and live-generation presentation.

## Active implementation order

Owner-approved order for the current fast, manually tested development cycle:

### Performance work before the rendering migration

1. [x] **Bounded transcript/session access.** Implemented in `6f4a6d3`;
   transcript history now loads automatically near the top without exposing
   pagination controls.
2. [x] **Remove duplicate selected-chat model derivation.** Transcript detail
   seeds model/thinking state and active-chat attachment no longer repeats the
   runtime-aware model request.
3. [x] **Progressive startup.** Implemented in the current follow-up: selected
   chat/catalogue requests run concurrently; optional capabilities, templates,
   and installation data do not gate the transcript; workspace suggestions are
   lazy.
4. [x] **Host-Pi preflight simplification.** Resource validation now traverses
   metadata only while preserving symlink refusal, file-count limits, and
   aggregate-size limits.

Keep API response shapes stable through these changes so the rendering migration
does not inherit simultaneous persistence and transport churn.

### Rendering/state migration

After the narrow performance work:

1. [x] Normalized protocol and pure reducer fixtures. Approved after
   compatibility-path regression testing as the isolated migration foundation.
2. [x] Server Active Generation and Resume State. Approved after live
   reconnect testing; it runs alongside the compatibility stream.
3. [x] Client Active Generation with the existing visual projection. Approved
   after live streaming, stop, regenerate, edit, reload, and navigation
   testing; it includes provider-overlap and resumed-trace regressions plus
   chat-local per-model thinking preferences.
4. Reconnect, batching, and backpressure.
5. Bounded Markdown rendering.
6. Compatibility-path removal.

Defer workspace inspection, clone lifecycle, auth serialization, and the
build-coupled test fixture until after the rendering migration; they are
independent and would interrupt its visual feedback loop.

For each slice, run focused automated tests plus typecheck/build as warranted,
restart with `bash .devcontainer/start-conduit.sh restart`, and provide concrete
manual checks. Do not run Playwright unless the owner specifically requests it.

## Source notes

- Transcript access: `conduit-web/src/session-store.js`, `conduit-web/src/chat-store.js` (`registry.find`), and the session/model/live-session routes in `conduit-web/src/server.js`
- Startup orchestration: `conduit-web/src/client/main.tsx`
- Host-Pi resource validation: `conduit-web/src/native-resource-validation.js`
  (`validateNativeProjectResources`) and `conduit-web/src/server.js`
  (`nativePreflight`)
- Workspace inspection: `conduit-web/src/workspace-inspector.js` and `conduit-web/src/client/workspace/workspace-panel.tsx`
- Workspace clone lifecycle: `conduit-web/src/project-store.js`
- Authentication persistence: `conduit-web/src/auth-store.js` and `conduit-web/src/auth-middleware.js`
- Companion review: `rendering-state-architecture.md`

Line references are anchored to `c8257ad0206a68fb0453bcd2af61d7e90fa21eed`. The implementation agent should re-resolve them against its current checkout before editing; the named functions and architectural paths are the stable anchors.
