# Conduit distillations

Add an entry through `$tacit-knowledge` after explicit approval or validated repeated feedback.

## Entry template

### Short rule title

- **Type:** Invariant, preference, heuristic, or gotcha.
- **Rule:** Imperative, specific constraint.
- **Scope:** Code path or condition where it applies.
- **Evidence:** Focused test, trace, or failure mode that established it.

## Architecture and safety invariants

### Require explicit release authority

- **Type:** Invariant.
- **Rule:** Do not create or push a version tag, create a GitHub Release, or start a release workflow unless the operator explicitly requests that release action. Treat fix, commit, and push requests as unreleased work.
- **Scope:** All release publication and version-tag operations.
- **Evidence:** The operator explicitly separated ordinary commits from release authority after the v0.5.5 publication.

### Treat development terminals as disposable

- **Type:** Preference.
- **Rule:** Restart a development Conduit server when validation requires it, even when the restart ends running Workspace terminal sessions; do not pause for confirmation only because development terminals are active.
- **Scope:** Local development and branch-validation servers only. This permission does not apply to production services or other user data.
- **Evidence:** The operator explicitly approved unconditional development restarts after a terminal session blocked deployment of the validated reconnect fix.

### Keep transcript and catalog ownership singular

- **Type:** Invariant.
- **Rule:** Treat Pi JSONL as authoritative transcript state; keep Conduit JSON stores limited to identity, registry, and preferences; never duplicate transcript ownership or allow concurrent Pi writers.
- **Scope:** Session indexing, chat creation/deletion, forks, reconnects, and persistence.
- **Evidence:** Session-index serialization, transcript-family deletion, and bounded transcript-history work established the split between Pi files and Conduit stores.

### Let the server own live-process lifecycle

- **Type:** Invariant.
- **Rule:** Serialize live-chat lifecycle transitions in the server; browser disconnect/reconnect must not stop a Pi process; never auto-stop a process that is generating, compacting, retrying, waiting on host UI, or has clients attached; destructive deletion must confirm and stop the matching process before removing its state.
- **Scope:** Live chat start/stop, reconnect, process cleanup, chat/project deletion.
- **Evidence:** `chat-lifecycle` transition serialization and process/delete regression work.

### Serve metadata before transcripts

- **Type:** Heuristic.
- **Rule:** Serve ordinary sidebar and dashboard requests from bounded registry metadata, enrich only a capped recent window, and load full transcripts lazily.
- **Scope:** Chat lists, project dashboards, session discovery, and navigation endpoints.
- **Evidence:** Transcript-history bounds and `project-dashboard` enrichment-cap tests.

### Resolve untrusted paths once at the server boundary

- **Type:** Invariant.
- **Rule:** Resolve browser paths through server allowlists and real paths, reject symlinks and malformed input, publish attachments atomically, and map sessions by canonical JSONL `cwd`; never set `PI_CODING_AGENT_SESSION_DIR`, pass `--session-dir`, or put Pi session/config state inside a worktree.
- **Scope:** Workspace APIs, attachments, Pi launch/session mapping, and native resources.
- **Evidence:** Workspace-path and native-resource symlink tests plus `session_cwd_mismatch` validation.

### Keep Pi installations separate

- **Type:** Invariant.
- **Rule:** Keep Isolated Pi and Host Pi models, settings, credentials, sessions, and runtime APIs installation-specific; browser-managed credentials may access only bundled Isolated Pi `auth.json` and must not expose OAuth URLs, device codes, or credentials across sessions.
- **Scope:** Runtime-aware model/settings APIs and browser credential management.
- **Evidence:** Host/Isolated runtime work and scoped model-catalog tests.

### Verify RPC against the pinned Pi

- **Type:** Gotcha.
- **Rule:** Verify shared RPC behavior against the locally pinned `@earendil-works/pi-coding-agent` (`0.84.1`); for Pi research use DeepWiki against `earendil-works/pi`, retry corrected lookups, and treat upstream results as advisory context rather than the compatibility contract.
- **Scope:** Changes shared by Isolated Pi and Host Pi.
- **Evidence:** The two-runtime boundary depends on the installed package contract, while upstream documentation describes a moving target.

### Repair persisted models through Pi

- **Type:** Gotcha.
- **Rule:** When an isolated Pi session persists a model outside its current scope, launch the same JSONL with the scoped fallback, then call Pi `set_model`; do not rely on `--model` to record the replacement for an existing session. Return recovery metadata and do not make the historical model selectable.
- **Scope:** Isolated Pi live-session resume, chat-model API, and model selector.
- **Evidence:** `live-session-launcher.test.js` verifies fallback launch, Pi model-change persistence, and recovery metadata; `app.spec.js` covers the warning and picker exclusion.

### Keep one authentication boundary

- **Type:** Invariant.
- **Rule:** Put every application route, static asset, and upload behind `requireAuth` except `GET /login`, `POST /v0/auth/login`, `GET /healthz`, and the public PWA bootstrap assets; validate the session cookie before WebSocket upgrade; require a password on non-loopback binds and never use the insecure override.
- **Scope:** HTTP routes, static assets, uploads, and WebSocket upgrades.
- **Evidence:** Protected-auth implementation and route/upgrade tests.

### Preserve streaming and navigation identity

- **Type:** Invariant.
- **Rule:** Keep durable timeline keys, reconcile optimistic entries in place, keep one element type through streaming→final, assign state to the narrowest owner, use load-then-commit navigation, and avoid intrinsic placeholders that perturb initial scroll math.
- **Scope:** Solid timeline rendering, chat navigation, and catalogue/runtime/active-chat state.
- **Evidence:** Existing rendering distillations and browser identity/navigation regressions.

### Keep one client interpretation layer

- **Type:** Invariant.
- **Rule:** Render assistant Markdown through `src/client/chat/markdown.tsx` and its renderer modules; keep URL policy and DOM sanitization in `src/client/chat/markdown-security.ts`, user prompts literal, and tool rendering data-driven with useful generic cards for unknown tools; use Kobalte as the only accessibility primitive, keep the client strict TypeScript without React production dependencies, and expose new keyboard-relevant actions through the typed Cmd/Ctrl+K palette.
- **Scope:** Client rendering, tool cards, accessibility primitives, and new surface features.
- **Evidence:** Client architecture and UI-parity constraints.

### Treat executable inputs and package overlays as controlled artifacts

- **Type:** Gotcha.
- **Rule:** Review Pi extensions, skills, and template tool lists before adoption; use `.devcontainer/solid-components.sh dev|serve|preview|promote|status|registry` for the managed component lifecycle; never copy package code, edit `node_modules`, change the lockfile, or run `npm ci`, setup, deploy, or unrelated rebuilds while an overlay is active; preview and promote the exact approved artifact without reimplementation.
- **Scope:** Pi configuration and shared-component integration/release work.
- **Evidence:** Stale Vite prebundles and deploy-time `npm ci` restored the registry package over local candidates; package tests also failed to establish consumer behavior until the packed artifact was verified at port 4310 and approved.

### Keep repository state and documentation current

- **Type:** Invariant.
- **Rule:** Never commit `.env*` except sanitized examples, `data/`, credentials, logs, `dist/`, or `node_modules/`; describe current behavior in documentation, replace obsolete text, keep `README.md`, `AGENTS.md`, and the `conduit-web/README.md` API/protocol contract synchronized with behavior, keep runtime/API changes additive, keep `docs/` current-state and `specs/` transient, and keep history in Git rather than in the docs.
- **Scope:** Every change and every maintained repository document.
- **Evidence:** Deployment/documentation consolidation and release-artifact hygiene work.

## UI and component heuristics

### Let browser media request file ranges directly

- **Type:** Gotcha.
- **Rule:** Mount the selected media state immediately and use authenticated inline URLs for browser players. Do not wait for `arrayBuffer()` before displaying them. Keep the bounded blob fallback for native clients that require bearer headers.
- **Scope:** `WorkspaceFileSlot` and the project file route.
- **Evidence:** Full-file buffering appeared fast on loopback but delayed players through Cloudflare. The operator accepted direct URLs and immediate loading states on 2026-09-06.

### Prove scrollbar behaviour with native pixels and input

- **Type:** Gotcha.
- **Rule:** Check hidden and revealed screenshots plus wheel and drag input; do not accept computed scrollbar pseudo-element styles as paint evidence. Non-auto standard scrollbar properties can override WebKit painting. Keep delayed edge reveal in the shared overlay rather than adding per-pane scrollbar rules.
- **Scope:** `navigation/overlay-scrollbars.ts`, native scrollbar fallbacks, and scrollable workspace panes.
- **Evidence:** Native thumbs kept arrows and showed no hover change despite the reported pseudo-element styles. The accepted overlay passed `scripts/check-overlay-scrollbars.mjs` on the sidebar, graph, file tree, and both preview axes: cancelled pass-through, visible reveal, wheel, drag, and unchanged pane dimensions.

### Edit shortcuts inline and save explicitly

- **Type:** Preference.
- **Rule:** Keep shortcut customization in one searchable Settings list backed by the command registry. Expand one recorder inside its command row, show captured strokes and conflicts there, and require an explicit save; do not open a nested shortcut dialog or change a binding merely because a key reached the recorder.
- **Scope:** Settings → Shortcuts and future command-registry configuration surfaces.
- **Evidence:** The accepted shortcut-manager sprint established inline one- and two-stroke recording, browser warnings, overlap blocking, live keycap updates, and stacked mobile rows; manual review explicitly accepted the resulting Settings UI.

### Distinguish palette actions from shortcut hints

- **Type:** Preference.
- **Rule:** In a palette shortcut footer, enclose an actionable keycap and label in one outlined button and render its label with the foreground color. Keep non-interactive shortcut labels muted. Apply the foreground treatment only when the control is available to click.
- **Scope:** `CommandHintBar` and future palette footer controls.
- **Evidence:** The accepted `Edit chats` and `Done` controls established the convention; manual review then required the available `Delete` and `Move` controls to use the same white-label affordance.

### Fill the mobile viewport without losing the palette frame

- **Type:** Preference.
- **Rule:** At the app’s mobile breakpoint, make command and search palettes fill the visual viewport inside a small, consistent inset. Keep the rounded border and shadow so the palette remains a dialog; do not leave a capped-height centered card on tall narrow screens or switch to a borderless full-screen route.
- **Scope:** Root command palette and all first-class palette pages at widths up to 760px.
- **Evidence:** Manual review at a 523px-wide tall viewport found the chat-search list capped at desktop height while the app had already entered its mobile layout.

### Keep composer frost inside the transcript scrollport

- **Type:** Gotcha.
- **Rule:** Put the frost composer in the same overflow scroller as the transcript, sticky to the bottom. Do not overlay it from a `z-index` sibling of `.transcript` or `.message-scroller-viewport`. `backdrop-filter` cannot sample that sibling paint group; raising blur or moving the rule onto a child overlay will not fix it. Do not treat authored CSS strings or an absolutely positioned test stripe as proof of live frost.
- **Scope:** `.composer`, `.composer-stack`, and transcript/composer overlap.
- **Evidence:** `660fad3` hid text with a 90% card tint, not live blur. Later overlays showed sharp transcript through a 17% pane while tests still asserted `blur(Npx)`. An in-flow striped paragraph inside the viewport blurred; the same paint as an overlay sibling did not. The accepted path is sticky `.composer-stack` as the transcript `stickyFooter`.

### Author only unprefixed backdrop-filter for production CSS

- **Type:** Gotcha.
- **Rule:** Write `backdrop-filter` only. Do not pair it with `-webkit-backdrop-filter` in source. LightningCSS then emits only the prefixed property, which current Chrome reports as invalid and ignores.
- **Scope:** Production CSS processed by Tailwind/LightningCSS, especially `.composer[data-composer-surface="frost"]`.
- **Evidence:** Built `index-*.css` contained `-webkit-backdrop-filter:blur(21px)` and no standard property. Chrome DevTools marked the prefix invalid. After authoring the unprefixed rule alone, the bundle kept both declarations. `scripts/check-bundle.mjs` now fails if LightningCSS drops the unprefixed property.

### Keep browser-hosted shortcuts inside an app-owned path

- **Type:** Gotcha.
- **Rule:** Do not rely on browser-reserved `Ctrl/Cmd+Shift` or `Alt+Shift` chords for palette actions. Use the palette-scoped `Ctrl/Cmd+K` then action-key path, render platform-specific modifier labels, and restore palette input focus after a nested confirmation closes so the next chord remains app-owned. Handle unmodified bulk-action keys only while the results list owns the event; when the search composer owns it, letters and Delete must edit the query.
- **Scope:** Chat-search and future command-palette keyboard actions in browser-hosted Conduit.
- **Evidence:** Chrome consumed the single-chat delete chord and could consume it again after an escaped confirmation. Playwright clearing the search composer in edit mode also sent Delete and opened the bulk-delete dialog. The accepted palette tests cover the action prefix, focus restoration, filtered selection retention, and safe query clearing.

### Keep browser terminal paste and cell rendering host-owned

- **Type:** Invariant.
- **Rule:** Treat browser paste as separate from OSC 52: consume each supported paste chord with `preventDefault()` and send clipboard text once. Render xterm through WebGL for full-screen TUI cell continuity, but retain automatic DOM fallback after WebGL failure or context loss.
- **Scope:** `terminal-renderer.ts` clipboard shortcuts and xterm renderer setup.
- **Evidence:** The focused desktop Chromium test sends `Ctrl+V` and `Ctrl+Shift+V` exactly once. User validation confirmed WebGL removed OpenCode's fixed-position cell seams at every browser scale.

### Capture voice shortcuts before browser handling

- **Type:** Gotcha.
- **Rule:** Handle the voice push-to-talk chord on `window` in the capture phase, prevent its default action, and stop propagation before starting capture; migrate the old `Super+D` default instead of leaving existing stored bindings to invoke the browser command.
- **Scope:** Composer voice dictation keyboard handling.
- **Evidence:** Chrome treated `Ctrl+Shift+D` as bookmark-all-tabs when the page handler ran in the bubble phase. `test/browser/app.spec.js` verifies the captured chord does not reach a document listener or open another tab.

### Keep mobile touch activation semantics explicit

- **Type:** Gotcha.
- **Rule:** Do not infer mobile push-to-talk behavior from the saved activation setting. The composer microphone button currently calls `toggleDictation()` for every tap; only the keyboard shortcut path handles push-to-talk keydown and keyup. A future touch push-to-talk control must implement press and release explicitly.
- **Scope:** Mobile composer voice controls and future native-sized touch targets.
- **Evidence:** `composer.tsx` routes the microphone button through `toggleDictation()` while its window key handlers branch on `push_to_talk`; the user accepted WP3 on mobile with this limitation deferred.

### Decouple microphone capture from ASR readiness

- **Type:** Invariant.
- **Rule:** Start browser microphone and `AudioWorklet` setup in parallel with the dictation WebSocket, buffer PCM within a fixed byte limit, and send no PCM until the server emits `ready`; use the browser input selector and signal test to diagnose device choice before trusting a transcript.
- **Scope:** `voice-dictation-client.ts`, `voice-audio.ts`, and Settings → Voice.
- **Evidence:** The measured one-second startup delay came from waiting for the server handshake before capture. The focused browser test proves capture and waveform state start before `ready`, queued audio stays off the socket, and PCM flushes after `ready`; the silent-input test prevents the short `you` hallucination.

### Keep authoritative VAD decisions server-side

- **Type:** Invariant.
- **Rule:** Keep Silero authoritative in Conduit. For local batch adapters, process closed ranges incrementally and flush the final result at Stop; for remote or compatibility adapters, wait until Stop. Submit only selected padded ranges, retain short speech, merge overflow into a bounded tail, keep complete accepted PCM in the archive, and never restore RMS segmentation to the authenticated path.
- **Scope:** `dictation-stream.js`, `voice-vad.js` incremental sessions, voice diagnostics, and archived voice sidecars.
- **Evidence:** WP4B focused tests cover silence-only no-submit behavior, short-range submission, padded multi-region ordering, and segment-cap tail preservation. WP5 focused tests cover a stable final before Stop, ordered tail append, and failed-range retention. The accepted sidecar `2026-08-15T14-18-07-767Z-739d2241-3737-4005-aced-e24764c69dea.json` records a Silero positive at 0.89368 during silence and Parakeet's `Mm-hmm.` hallucination; treat this as a false-positive/noise-quality issue, not permission to move VAD into the browser. The approved WP5 sidecar `2026-08-15T15-32-21-828Z-ee4f2317-0d3c-4816-9e09-516a9cd758c6.json` confirms 49,240 ms of archived mono PCM16, 9 of 9 progressive ranges completed, no fallback, and a first segment final at 3,878 ms.

### Keep local voice selection through installation polling

- **Type:** Gotcha.
- **Rule:** During managed model installation polling, preserve the current local selection and invalidate settings GET responses that overlap a Save; never let a stale poll response replace the selected tuple with the legacy default profile.
- **Scope:** `Settings` voice settings load/save and managed model installation refreshes.
- **Evidence:** Desktop and mobile regression coverage now simulates Save followed by a stale Whisper response and keeps the selected Parakeet `transcribe-rs` profile. The full browser voice slice passed 8/8 and the full suite passed 522/522.

### Amortize buffered Parakeet streaming before lowering latency

- **Type:** Gotcha.
- **Rule:** For `transcribe_cpp_stream_v1` on a CPU host, use a supported
  `parakeet_buffered` profile with a chunk large enough to amortize the
  sliding-window encoder work. Keep the 20 ms transport packets and 160 ms
  server feed quantum independent from that profile. Do not blame the model
  size alone when a low-latency profile falls behind.
- **Scope:** Unified English Q8 Live through `transcribe.cpp`.
- **Evidence:** WP7 recorded a 5,020 ms queue and `live_queue_overflow` with
  the 480 ms profile on the 13,340 ms reference WAV. The same model and input
  held the paced adapter queue to 500 ms and drained to 0 ms with the supported
  1,120 ms profile. The focused Stop-drain and overflow tests preserve the
  scheduler and failure boundary.

### Preserve authored timelines when animations self-clean

- **Type:** Invariant.
- **Rule:** When an animation removes its own DOM on `animationend`, do not let a global reduced-motion duration clamp collapse it; preserve its authored duration for the explicitly enabled effect, or provide a static fallback.
- **Scope:** `MeteorShower` and any future timeline-driven decorative component with animation-end cleanup.
- **Evidence:** Browsers reporting `prefers-reduced-motion: reduce` changed every meteor to `0.01ms`, immediately removing it. `test/browser/app.spec.js` now verifies that the supplied meteor duration survives under that preference.

### Render long schedules as bounded live windows

- **Type:** Heuristic.
- **Rule:** Preserve a deterministic long-horizon schedule in the clock and data model, but render only the active events plus the next scheduled event. Record transient resize geometry without regenerating the live window; adopt it at a natural cycle boundary.
- **Scope:** Timeline-driven visual components inside resizable Conduit surfaces, beginning with `DefaultMeteorShower`.
- **Evidence:** Pre-rendering the ten-minute meteor forecast created 533 meteors and 533 tails; docked panel transitions then resized that entire animated scene, and a debounced forecast replacement produced a second blink and horizontal jump after the transition. The bounded `maxActive + 1` renderer with cycle-boundary geometry adoption passed deterministic package tests and manual 144 Hz validation with Conduit's original docked panels.

### Classify visual flicker with paired, narrow captures

- **Type:** Heuristic.
- **Rule:** Before adding a cache or changing lifecycle code, capture one interaction with a scoped DOM mutation observer and a Network filter for the implicated API. Use the DOM record to distinguish removal/remount from a state update, then correlate only the matching requests.
- **Scope:** Expensive or intermittent visual regressions, especially workspace navigation. Do not begin with a giant Performance trace or infer the cause from a screenshot.
- **Evidence:** Slice 1's RHS trace proved that the panel node was removed between chat navigations; the filtered `diff` requests established repeated fetches rather than a paint-only artifact.

### Read the route contract before interpreting network status

- **Type:** Gotcha.
- **Rule:** Resolve the client initiator and server route before classifying a network request as process creation, reconnection, or duplication. HTTP status alone is insufficient.
- **Scope:** Conduit lifecycle endpoints, particularly `POST /v0/live-sessions`.
- **Evidence:** The Slice 1 trace showed repeated `201` responses; `server.js` showed that a resident chat process also returns `201`, ruling out the proposed duplicate-Pi diagnosis.

### Preserve persistent Solid surfaces with boolean gates and accessors

- **Type:** Invariant.
- **Rule:** Gate a surface meant to survive identity changes with a boolean condition, and pass changing chat/project identities as Solid accessors. Do not use an identity-bearing value as the mounting condition or capture it as a static component prop.
- **Scope:** Long-lived client surfaces such as `WorkspacePanel` during chat navigation.
- **Evidence:** Slice 1's mutation trace showed the RHS component unmounting across selected chat IDs. Browser regressions now assert panel-node identity and cached Git status across same-project and return navigation.

### Cache workspace projection by project, not Pi residency

- **Type:** Invariant.
- **Rule:** Scope files, Git status, and diff projection to the canonical workspace project. Keep that cache independent from the live Pi-process registry and its warm-pool policy.
- **Scope:** Client workspace navigation and preloading. Pi processes own execution and transcripts; the UI cache owns only recent presentation data.
- **Evidence:** Slice 1 restored recent workspace status without coupling it to process lifetime, avoiding both remount flash and a second source of session ownership.

### Keep Workspace panel state project-scoped

- **Type:** Invariant.
- **Rule:** Store Workspace panel visibility and contents under `project:<projectId>` and geometry under the raw project ID for compatibility; do not key current panel state by the selected chat. Keep `wrap-lines` global and remove both project scopes plus session scopes when a project is deleted.
- **Scope:** `main.tsx`, `workspace-panel.tsx`, and `workspace-panel-storage.ts`.
- **Evidence:** Accepted persisted-panel-state slice; `workspace-panel-storage.test.js` covers migration, scope removal, storage failure fallback, and the 100-scope cap.

### Drive workspace freshness from one version signal

- **Type:** Invariant.
- **Rule:** Use one workspace version probe and its changed paths to refresh Files and Source Control. Do not poll every loaded directory or open file. Treat `changedPaths: null` as a full visible refresh, and run the probe only while the panel is visible and online.
- **Scope:** `WorkspacePanel` freshness scheduling and `workspace-inspector` change tracking.
- **Evidence:** Focused native-watch and fallback tests cover change detection; live manual validation confirmed external, user, and model updates appear immediately.

### Bound Git inspection and make patch text opt-in

- **Type:** Invariant.
- **Rule:** Globally cap and cancel Git child processes, share the active per-project overview, and request a working-tree patch only when its disclosure is opened.
- **Scope:** `readWorkspaceDiff` and the Source Control panel. Treat patch generation as detail work, never as a prerequisite for branch/status rendering.
- **Evidence:** Slice 1 added a four-process cap, timeout/cancellation, overview→patch reuse, and focused tests for shared inspection and cancellation.

### Fan out terminal lifecycle changes

- **Type:** Invariant.
- **Rule:** Publish PTY creation, exit, update, and removal through the shared runtime stream; on each event, refresh the server terminal list and clear any selected terminal that no longer runs. Do not rely on the attached terminal WebSocket or a local window event to synchronize other clients.
- **Scope:** Runtime SSE, terminal panes, sidebar terminal rows, and dashboard terminal lists.
- **Evidence:** The two-client takeover reproduction left the original pane showing a dead terminal until it opened the sessions menu. Runtime lifecycle events, server reconciliation, and focused runtime/recovery tests close that stale-selection path.

### Separate resize mechanics from panel presentation

- **Type:** Gotcha.
- **Rule:** Never transition a CSS property while pointer input directly changes it. Keep the resize shell immediate and overflow-visible for its gutter, schedule pointer updates with `requestAnimationFrame`, and persist only when the gesture ends. During open/close, animate one shared conversation surface instead of separate transcript and composer surfaces. Never write geometry variables on a transcript ancestor; apply dynamic geometry to the narrowest rendered control and ignore width-only observer notifications when CSS can own that axis.
- **Scope:** Resizable Solid surfaces, beginning with `WorkspacePanel`, panel-driven transcript/composer motion, and overlay controls such as the scroll-to-latest button. A visible panel surface may clip its contents; its edge-spanning resize target must not be clipped with them.
- **Evidence:** The shared 160ms width transition was continuously retargeted during drag, causing cursor-to-panel lag; `overflow: hidden` cut the `left: -12px; width: 24px` workspace gutter in half. A later composer `ResizeObserver` wrote two inherited variables on `.transcript`, and Chrome then walked 10,588 elements for 30–42ms during panel motion. Button-local geometry and shared conversation motion passed the focused panel contract plus workspace resize and open/close browser checks; manual review found the result substantially smoother.

### Freeze transcript descendants during workspace expansion

- **Type:** Heuristic.
- **Rule:** Mark desktop Workspace expansion before changing `workspaceExpanded`, and apply `content-visibility: hidden` to `.transcript-motion-shell` for the shared 160ms motion in both directions. Keep the outer shell, Workspace surface, and composer live; do not guard only the expanded state, because restore also changes flex geometry and can restart scroll-follow.
- **Scope:** `workspaceExpanded` in `main.tsx`, Workspace panel motion, and transcript scroll-follow.
- **Evidence:** A native Chrome trace changed expand from 199 layouts and 47.5ms layout time with seven scroll events to 54 layouts and 26.8ms with one short event. Restore changed from 365 layouts and 79.0ms with 13 scroll events to 61 layouts and 13.7ms with ten short post-release events. The focused expansion regression and both scroll harnesses passed.

## Streaming Markdown renderer invariants

### Preserve native display identity across transient slices

- **Type:** Invariant.
- **Rule:** Key Incremark display blocks by stable source-offset IDs. Keep completed blocks and the active block in one keyed list. When the native transformer emits an empty or shorter cached slice during append-only output, preserve the previous block shape instead of removing rows or cells.
- **Scope:** `incremark-markdown.tsx`, table streaming, and `BlockTransformer` integration.
- **Evidence:** An append-only six-row AST produced 37 DOM table-structure changes and 45–60 top reversals. Stable block identity and monotonic table preservation reduced top reversals to zero.

### Promote nested math before native slicing

- **Type:** Invariant.
- **Rule:** Treat `inlineMath` and `math` nodes inside paragraphs, lists, and table cells as atomic leaves before they enter the native transformer. Remount only the leaf when its AST type changes; preserve the containing paragraph, table, row, and cell.
- **Scope:** Incremark AST adaptation and table-cell rendering.
- **Evidence:** Nested math produced 34 geometry transitions and empty formula cells. Atomic promotion and reactive leaf transitions reduced the long-stream case to one geometry settle and rendered all formula cells during streaming.

### Preserve the visible tail when a delimiter becomes pending

- **Type:** Invariant.
- **Rule:** When a new math opener makes the current construct pending, preserve earlier visible children from the previous AST and use the current prefix only for the final child. Keep the pending placeholder inside the original parent. Never pass a shorter prefix as a replacement block, and never preserve the entire prior AST.
- **Scope:** Typewriter pending-prefix reconciliation.
- **Evidence:** The shorter pending prefix caused paragraph shrinkage at source positions 102 and 222. Preserving the entire prior AST leaked the opening `$`. The narrowed child merge removed both failures and restored zero reversals with exact source/display parity.

### Treat table parser protection as a scoped, fail-open projection

- **Type:** Invariant.
- **Rule:** Before reparsing streamed table prefixes, protect only math-internal pipes with a collision-free sentinel, then restore the original source after parsing. If no safe sentinel exists, skip the projection. Preserve literal `$PATH`, `$HOME`, and ordinary dollar text.
- **Scope:** `table-math.ts`, pending-prefix reparsing, and synthetic preview reparsing.
- **Evidence:** Unprotected `\ln|x|` changed table column identity during pending reparses. The review also found `$PATH` truncation and `$X | yes` cell collapse.

### Use automatic table geometry for progressive content

- **Type:** Heuristic.
- **Rule:** Keep streaming and final tables on the same automatic layout model. Do not derive permanent column widths from the first row or use fixed geometry to hide reconciliation errors. Permit the bounded 150% table width only when the chat pane has spare room.
- **Scope:** Incremark tables containing progressive text or KaTeX.
- **Evidence:** Fixed `colgroup` percentages caused narrow first columns, KaTeX overflow, and different streaming/final layouts. Automatic layout removed the fixed-width regression.

### Keep synthetic math repair out of the source stream

- **Type:** Invariant.
- **Rule:** Apply synthetic closing delimiters only to a display projection of the active block. Keep the raw stream authoritative, preserve source offsets, cache by candidate content, and retain the last valid preview when a partial candidate fails.
- **Scope:** Synthetic renderer and provisional KaTeX.
- **Evidence:** Mutating the raw source would break incremental offsets and table reconciliation. Content-aware caching fixed empty final KaTeX caused by caching a mutable AST node by identity alone.

### Do not let provider cadence fight display cadence

- **Type:** Heuristic.
- **Rule:** When a renderer has a display queue, settle follow-scroll from display completion rather than every provider delta. Do not repeatedly write `scrollTop = scrollHeight` while the rendered tree is changing.
- **Scope:** Typewriter, Synthetic, and transcript scroll-follow.
- **Evidence:** The live probe recorded 105 scroll reversals and 109 answer-height reversals without long tasks. Provider-driven scroll writes were more frequent than display updates.

### Use native completion for terminal display metrics

- **Type:** Gotcha.
- **Rule:** Mark the transformer's `onAllComplete` sample as terminal. Do not use the last aggregated sample when live and persisted projections can coexist.
- **Scope:** Browser performance harness and Typewriter telemetry.
- **Evidence:** The last aggregate sample reported a 33-character backlog after the table was visibly complete. The native completion callback reported the correct zero backlog.

### Verify the pinned Solid adapter before using the published wrapper

- **Type:** Gotcha.
- **Rule:** Test `@incremark/solid` against Conduit's pinned Solid runtime before adopting it. If its JSX runtime or reference-link path fails, integrate `@incremark/core` through the existing custom adapter.
- **Scope:** Third-party renderer integration.
- **Evidence:** `@incremark/solid@1.0.2` failed against the pinned `solid-js` runtime and then failed at runtime in its link branch (`url` undefined).
