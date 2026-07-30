# Conduit distillations

Add an entry only through an explicit `$conduit-tacit-knowledge` invocation and user approval.

## Entry template

### Short rule title

- **Rule:** Imperative, specific constraint.
- **Scope:** Code path or condition where it applies.
- **Evidence:** Focused test, trace, or failure mode that established it.

### Preserve authored timelines when animations self-clean

- **Rule:** When an animation removes its own DOM on `animationend`, do not let a global reduced-motion duration clamp collapse it; preserve its authored duration for the explicitly enabled effect, or provide a static fallback.
- **Scope:** `MeteorShower` and any future timeline-driven decorative component with animation-end cleanup.
- **Evidence:** Browsers reporting `prefers-reduced-motion: reduce` changed every meteor to `0.01ms`, immediately removing it. `test/browser/app.spec.js` now verifies that the supplied meteor duration survives under that preference.

### Render long schedules as bounded live windows

- **Rule:** Preserve a deterministic long-horizon schedule in the clock and data model, but render only the active events plus the next scheduled event. Record transient resize geometry without regenerating the live window; adopt it at a natural cycle boundary.
- **Scope:** Timeline-driven visual components inside resizable Conduit surfaces, beginning with `DefaultMeteorShower`.
- **Evidence:** Pre-rendering the ten-minute meteor forecast created 533 meteors and 533 tails; docked panel transitions then resized that entire animated scene, and a debounced forecast replacement produced a second blink and horizontal jump after the transition. The bounded `maxActive + 1` renderer with cycle-boundary geometry adoption passed deterministic package tests and manual 144 Hz validation with Conduit's original docked panels.

### Classify visual flicker with paired, narrow captures

- **Rule:** Before adding a cache or changing lifecycle code, capture one interaction with a scoped DOM mutation observer and a Network filter for the implicated API. Use the DOM record to distinguish removal/remount from a state update, then correlate only the matching requests.
- **Scope:** Expensive or intermittent visual regressions, especially workspace navigation. Do not begin with a giant Performance trace or infer the cause from a screenshot.
- **Evidence:** Slice 1's RHS trace proved that the panel node was removed between chat navigations; the filtered `diff` requests established repeated fetches rather than a paint-only artifact.

### Read the route contract before interpreting network status

- **Rule:** Resolve the client initiator and server route before classifying a network request as process creation, reconnection, or duplication. HTTP status alone is insufficient.
- **Scope:** Conduit lifecycle endpoints, particularly `POST /v0/live-sessions`.
- **Evidence:** The Slice 1 trace showed repeated `201` responses; `server.js` showed that a resident chat process also returns `201`, ruling out the proposed duplicate-Pi diagnosis.

### Preserve persistent Solid surfaces with boolean gates and accessors

- **Rule:** Gate a surface meant to survive identity changes with a boolean condition, and pass changing chat/project identities as Solid accessors. Do not use an identity-bearing value as the mounting condition or capture it as a static component prop.
- **Scope:** Long-lived client surfaces such as `WorkspacePanel` during chat navigation.
- **Evidence:** Slice 1's mutation trace showed the RHS component unmounting across selected chat IDs. Browser regressions now assert panel-node identity and cached Git status across same-project and return navigation.

### Cache workspace projection by project, not Pi residency

- **Rule:** Scope files, Git status, and diff projection to the canonical workspace project. Keep that cache independent from the live Pi-process registry and its warm-pool policy.
- **Scope:** Client workspace navigation and preloading. Pi processes own execution and transcripts; the UI cache owns only recent presentation data.
- **Evidence:** Slice 1 restored recent workspace status without coupling it to process lifetime, avoiding both remount flash and a second source of session ownership.

### Bound Git inspection and make patch text opt-in

- **Rule:** Globally cap and cancel Git child processes, share the active per-project overview, and request a working-tree patch only when its disclosure is opened.
- **Scope:** `readWorkspaceDiff` and the Source Control panel. Treat patch generation as detail work, never as a prerequisite for branch/status rendering.
- **Evidence:** Slice 1 added a four-process cap, timeout/cancellation, overview→patch reuse, and focused tests for shared inspection and cancellation.

### Separate resize mechanics from panel presentation

- **Rule:** Never transition a CSS property while pointer input directly changes it. Put open/close animation on an inner presentation surface, keep the resize shell immediate and overflow-visible for its gutter, schedule pointer updates with `requestAnimationFrame`, and persist only when the gesture ends.
- **Scope:** Resizable Solid surfaces, beginning with `WorkspacePanel` and its detail splitter. A visible panel surface may clip its contents; its edge-spanning resize target must not be clipped with them.
- **Evidence:** The shared 160ms width transition was continuously retargeted during drag, causing cursor-to-panel lag; `overflow: hidden` cut the `left: -12px; width: 24px` workspace gutter in half. The focused browser workspace-panel test now rapidly drags the gutter and asserts the final width.

### Treat local package overlays as volatile build inputs

- **Rule:** When testing a local `solid-components` build in Conduit, use one dedicated overlay command that copies or aliases the exact candidate artifact, invalidates Vite/PWA output, and forces the managed rebuild/restart. Never run `npm ci`, setup, or deploy while the overlay is active; they restore the registry package.
- **Scope:** Conduit's Vite resolution, managed server lifecycle, and local shared-component validation.
- **Evidence:** Vite continued serving the 516-node 0.1.0 prebundle after replacing `dist`; `deploy` then ran `npm ci` and removed the working candidate.

### Release only the approved consumer build

- **Rule:** Keep a candidate untagged and unpublished until Conduit runs the exact locally built package and the user approves the interaction. After approval, release the same source commit and distributable payload without reimplementation.
- **Scope:** Stable `solid-components` releases originating from Conduit integration work.
- **Evidence:** Package tests alone did not establish consumer behavior, and stale caches initially kept Conduit on the previous renderer; approval became meaningful only after the packed candidate was verified at port 4310.
