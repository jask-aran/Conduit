# Conduit distillations

Add an entry through `$tacit-knowledge` after explicit approval or validated repeated feedback.

## Entry template

### Short rule title

- **Type:** Invariant, preference, heuristic, or gotcha.
- **Rule:** Imperative, specific constraint.
- **Scope:** Code path or condition where it applies.
- **Evidence:** Focused test, trace, or failure mode that established it.

## Architecture and safety invariants

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
- **Rule:** Verify shared RPC behavior against the locally pinned `@earendil-works/pi-coding-agent` (`0.80.6`); for Pi research use DeepWiki against `earendil-works/pi`, retry corrected lookups, and treat upstream results as advisory context rather than the compatibility contract.
- **Scope:** Changes shared by Isolated Pi and Host Pi.
- **Evidence:** The two-runtime boundary depends on the installed package contract, while upstream documentation describes a moving target.

### Keep one authentication boundary

- **Type:** Invariant.
- **Rule:** Put every route, static asset, and upload behind `requireAuth` except `GET /login`, `POST /v0/auth/login`, and `GET /healthz`; validate the session cookie before WebSocket upgrade; require a password on non-loopback binds and never use the insecure override.
- **Scope:** HTTP routes, static assets, uploads, and WebSocket upgrades.
- **Evidence:** Protected-auth implementation and route/upgrade tests.

### Preserve streaming and navigation identity

- **Type:** Invariant.
- **Rule:** Keep durable timeline keys, reconcile optimistic entries in place, keep one element type through streaming→final, assign state to the narrowest owner, use load-then-commit navigation, and avoid intrinsic placeholders that perturb initial scroll math.
- **Scope:** Solid timeline rendering, chat navigation, and catalogue/runtime/active-chat state.
- **Evidence:** Existing rendering distillations and browser identity/navigation regressions.

### Keep one client interpretation layer

- **Type:** Invariant.
- **Rule:** Render assistant Markdown only through `src/client/chat/markdown.tsx` (Marked, DOMPurify, KaTeX); keep user prompts literal and use one data-driven tool registry with useful generic cards for unknown tools; use Kobalte as the only accessibility primitive, keep the client strict TypeScript without React production dependencies, and expose new keyboard-relevant actions through the typed Cmd/Ctrl+K palette.
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

### Bound Git inspection and make patch text opt-in

- **Type:** Invariant.
- **Rule:** Globally cap and cancel Git child processes, share the active per-project overview, and request a working-tree patch only when its disclosure is opened.
- **Scope:** `readWorkspaceDiff` and the Source Control panel. Treat patch generation as detail work, never as a prerequisite for branch/status rendering.
- **Evidence:** Slice 1 added a four-process cap, timeout/cancellation, overview→patch reuse, and focused tests for shared inspection and cancellation.

### Separate resize mechanics from panel presentation

- **Type:** Gotcha.
- **Rule:** Never transition a CSS property while pointer input directly changes it. Put open/close animation on an inner presentation surface, keep the resize shell immediate and overflow-visible for its gutter, schedule pointer updates with `requestAnimationFrame`, and persist only when the gesture ends.
- **Scope:** Resizable Solid surfaces, beginning with `WorkspacePanel` and its detail splitter. A visible panel surface may clip its contents; its edge-spanning resize target must not be clipped with them.
- **Evidence:** The shared 160ms width transition was continuously retargeted during drag, causing cursor-to-panel lag; `overflow: hidden` cut the `left: -12px; width: 24px` workspace gutter in half. The focused browser workspace-panel test now rapidly drags the gutter and asserts the final width.

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
